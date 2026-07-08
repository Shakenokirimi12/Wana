// Wana symbolicator container — wraps `llvm-symbolizer` in a tiny HTTP API
// so the dashboard worker can resolve native crash addresses against a
// dSYM held in R2.
//
// Protocol (POST /symbolicate):
//
//	{
//	  "dsym_b64":         "<base64 of dSYM DWARF bytes>",
//	  "image_load_addr":  "0x100000000",     // base address the image was loaded at
//	  "addresses":        ["0x10004f4d8", ...] // crash frame addresses
//	}
//
// Response (200):
//
//	{
//	  "frames": [
//	    { "address": "0x10004f4d8", "function": "...", "file": "...", "line": 42 },
//	    ...
//	  ]
//	}
//
// llvm-symbolizer wants instruction offsets RELATIVE TO the dSYM, not
// process-load addresses. Caller passes `image_load_addr` so we subtract
// it from each input address before piping to the tool. (Same trick
// Sentry's symbolicator service does internally.)
package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	// Bigger than typical dSYM (200 MB) is rejected — disk is ephemeral
	// but we still don't want one bad request filling the 4 GB volume.
	maxDsymBytes       = 800 * 1024 * 1024
	symbolizerTimeout  = 60 * time.Second
	listenAddr         = ":8080"
	healthCheckTimeout = 2 * time.Second
)

type symbolicateRequest struct {
	DsymB64       string   `json:"dsym_b64"`
	ImageLoadAddr string   `json:"image_load_addr"`
	Addresses     []string `json:"addresses"`
}

type frameResult struct {
	Address  string `json:"address"`
	Function string `json:"function,omitempty"`
	File     string `json:"file,omitempty"`
	Line     int    `json:"line,omitempty"`
	// `unresolved` is set when llvm-symbolizer couldn't produce a real
	// symbol (returned "??" or empty). The caller can choose to retain
	// the raw frame or fall back to whatever the SDK shipped.
	Unresolved bool `json:"unresolved,omitempty"`
}

type symbolicateResponse struct {
	Frames []frameResult `json:"frames"`
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/symbolicate", handleSymbolicate)

	srv := &http.Server{
		Addr:              listenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	fmt.Printf("[symbolicator] listening on %s\n", listenAddr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintf(os.Stderr, "[symbolicator] server error: %v\n", err)
		os.Exit(1)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func handleSymbolicate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req symbolicateRequest
	body, err := io.ReadAll(io.LimitReader(r.Body, maxDsymBytes+1024))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body", err)
		return
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json", err)
		return
	}
	if len(req.Addresses) == 0 {
		writeError(w, http.StatusBadRequest, "no addresses provided", nil)
		return
	}

	dsymBytes, err := base64.StdEncoding.DecodeString(req.DsymB64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid base64 dsym", err)
		return
	}
	if len(dsymBytes) == 0 {
		writeError(w, http.StatusBadRequest, "empty dsym", nil)
		return
	}
	if len(dsymBytes) > maxDsymBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "dsym too large", nil)
		return
	}

	loadAddr, err := parseHexAddr(req.ImageLoadAddr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid image_load_addr", err)
		return
	}

	tmpDir, err := os.MkdirTemp("", "dsym-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "tmp dir failed", err)
		return
	}
	// Best-effort cleanup; the container's disk is ephemeral but we still
	// want to clear large blobs between requests inside one warm instance.
	defer os.RemoveAll(tmpDir)

	dsymPath := filepath.Join(tmpDir, "dwarf")
	if err := os.WriteFile(dsymPath, dsymBytes, 0o600); err != nil {
		writeError(w, http.StatusInternalServerError, "write dsym failed", err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), symbolizerTimeout)
	defer cancel()

	frames, err := runSymbolizer(ctx, dsymPath, loadAddr, req.Addresses)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "symbolizer failed", err)
		return
	}

	w.Header().Set("content-type", "application/json")
	if err := json.NewEncoder(w).Encode(symbolicateResponse{Frames: frames}); err != nil {
		// Already wrote header; just log.
		fmt.Fprintf(os.Stderr, "[symbolicator] encode response failed: %v\n", err)
	}
}

// runSymbolizer pipes addresses into a single `llvm-symbolizer` process
// and reads its line-oriented output back, mapping each input to a
// frame result. We use the `--obj=...` form so the same process can
// resolve all addresses against one dSYM in a single round trip.
func runSymbolizer(
	ctx context.Context,
	dsymPath string,
	loadAddr uint64,
	addresses []string,
) ([]frameResult, error) {
	cmd := exec.CommandContext(ctx,
		"llvm-symbolizer",
		"--obj="+dsymPath,
		"--demangle",
		"--functions=linkage",
		"--inlines=false",
		"--default-arch=arm64",
	)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start: %w", err)
	}

	// Build the inputs first: subtract the image load address from each
	// crash frame to get the dSYM-relative offset llvm-symbolizer expects.
	inputs := make([]uint64, 0, len(addresses))
	for _, a := range addresses {
		v, err := parseHexAddr(a)
		if err != nil {
			_ = stdin.Close()
			_ = cmd.Process.Kill()
			return nil, fmt.Errorf("invalid address %q: %w", a, err)
		}
		if v >= loadAddr {
			inputs = append(inputs, v-loadAddr)
		} else {
			// Negative offsets are nonsensical; record a placeholder so the
			// output array length still matches the input array.
			inputs = append(inputs, 0)
		}
	}

	// Stream inputs. We separate inputs by empty lines per the
	// llvm-symbolizer protocol: after each address, the tool prints
	// function\nfile:line:col\n\n.
	go func() {
		defer stdin.Close()
		w := bufio.NewWriter(stdin)
		for _, off := range inputs {
			fmt.Fprintf(w, "0x%x\n", off)
		}
		_ = w.Flush()
	}()

	frames := make([]frameResult, len(addresses))
	scanner := bufio.NewScanner(stdout)
	// Larger buffer for long demangled C++ symbols.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	idx := 0
	var fn, loc string
	step := 0 // 0 = expecting function, 1 = expecting file:line:col, 2 = expecting blank separator
	for scanner.Scan() {
		line := scanner.Text()
		switch step {
		case 0:
			fn = line
			step = 1
		case 1:
			loc = line
			step = 2
		case 2:
			// Blank line completes the current frame.
			if idx < len(frames) {
				frames[idx] = buildFrame(addresses[idx], fn, loc)
				idx++
			}
			fn = ""
			loc = ""
			step = 0
		}
		if idx >= len(frames) {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("read stdout: %w", err)
	}
	// Drain remaining (we may have stopped mid-record at the last frame).
	if idx < len(frames) && step == 1 && fn != "" {
		frames[idx] = buildFrame(addresses[idx], fn, "")
		idx++
	}
	for ; idx < len(frames); idx++ {
		frames[idx] = frameResult{Address: addresses[idx], Unresolved: true}
	}

	if err := cmd.Wait(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return nil, fmt.Errorf("llvm-symbolizer exited %d", exitErr.ExitCode())
		}
		return nil, fmt.Errorf("wait: %w", err)
	}
	return frames, nil
}

func buildFrame(addr, fn, loc string) frameResult {
	res := frameResult{Address: addr}
	if fn == "" || fn == "??" {
		res.Unresolved = true
		return res
	}
	res.Function = fn
	// loc shape: /path/to/file.swift:123:4 (col may be missing as :0)
	if loc != "" && loc != "??:0:0" && loc != "??:0" {
		// Split from the RIGHT so absolute paths with colons (rare) survive.
		colonCol := strings.LastIndex(loc, ":")
		if colonCol > 0 {
			rest := loc[:colonCol]
			colonLine := strings.LastIndex(rest, ":")
			if colonLine > 0 {
				file := rest[:colonLine]
				lineStr := rest[colonLine+1:]
				if n, err := strconv.Atoi(lineStr); err == nil {
					res.File = file
					res.Line = n
				} else {
					res.File = rest
				}
			} else {
				res.File = rest
			}
		} else {
			res.File = loc
		}
	}
	return res
}

func parseHexAddr(s string) (uint64, error) {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "0x") || strings.HasPrefix(s, "0X") {
		s = s[2:]
	}
	if s == "" {
		return 0, errors.New("empty")
	}
	return strconv.ParseUint(s, 16, 64)
}

func writeError(w http.ResponseWriter, status int, msg string, err error) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	payload := map[string]string{"error": msg}
	if err != nil {
		payload["detail"] = err.Error()
	}
	_ = json.NewEncoder(w).Encode(payload)
}
