# Stage 1: build the Go server.
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY main.go ./
# Static binary so the runtime image needs no Go toolchain.
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/symbolicator .

# Stage 2: tiny runtime with just llvm-symbolizer.
# Alpine's `llvm` package ships llvm-symbolizer as a single binary that
# understands DWARF inside Mach-O dSYM bundles — exactly what iOS/macOS
# crashes need.
FROM alpine:3.20
RUN apk add --no-cache llvm
WORKDIR /app
COPY --from=build /out/symbolicator /app/symbolicator
EXPOSE 8080
# llvm-symbolizer must be on PATH; verify.
RUN llvm-symbolizer --version
ENTRYPOINT ["/app/symbolicator"]
