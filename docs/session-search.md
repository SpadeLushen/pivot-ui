# Session text search

Session JSONL files remain the source of truth. SQLite is an optional,
rebuildable text cache, disabled by default. It uses Node's built-in
`node:sqlite` (Node 22.13+ recommended; Node 24 supported), without FTS
or trigram dependencies.

Settings → Storage controls enablement, database location, size and rebuilding.
The default path is `~/.pivot-ui/session-search.sqlite`. Search preferences are
shared; lifecycle changes go through `/api/session-search`, not the general
preferences patch API.

Only user/assistant message text is cached, across saved branches. Thinking,
tool records, images and user `<file>…</file>` attachment blocks are excluded.
The cache stores lowercase text for literal, Unicode-aware case-insensitive
substring matching. No model requests or attachment parsing are performed.

A background scan checks file size, mtime and ctime. Changed files are read
asynchronously and replaced transactionally, only if their fingerprint remains
stable. Deleted files are pruned. Completion events request a scan; a 30-second
timer covers external changes. Incomplete writes are retried on later scans.

Lifecycle operations are serialized. Cancellation is awaited before rebuilding,
moving or deleting. SQLite uses DELETE journaling so a closed cache is one file.
Migration rejects existing destinations (including sidecars), uses exclusive
copying for cross-volume moves, and retains the source until the new copy is
validated and its path saved. Disabling clears text before attempting deletion;
filesystem errors are reported without changing original session files.

Both search surfaces debounce for 500 ms, keep title matching available when
content search is disabled, and ignore obsolete requests. Sidebar results stay
within the selected workspace. All workspaces also matches workspace metadata.
Indexing progress warns that content results may be incomplete.
