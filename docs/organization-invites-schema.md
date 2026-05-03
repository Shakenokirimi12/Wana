# Organization invites — legacy columns and future cleanup

## Current schema (`organization_invites`)

- `invited_email`: bounds acceptance to a single normalized email when set.
- `invited_username`: historically used for “invite tied to a global username.” **Product direction** is Slack-style invites (**open link** or **email-bound** only). New invites write **`invited_username` as NULL**. Rows created before this change may still have a value; **acceptance no longer enforces** username matching (`acceptOrganizationInvite` / bootstrap flows ignore it).

## `users.username`

- Remains a **nullable unique** column for future profile / mention UX.
- **Bootstrap from invite** now creates users with **`username = null`** unless product adds a separate flow to choose a handle.

## Optional migration (later)

- Drop `organization_invites.invited_username` after backfill analysis, or keep as opaque legacy metadata.
- Revisit **`user_username_redirects`** when @mention or rename semantics are defined (global vs org-scoped handles).
