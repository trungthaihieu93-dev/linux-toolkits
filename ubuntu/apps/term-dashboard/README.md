# linux-term-dashboard (`td`)

A local web dashboard for terminal and shell configuration on Linux. Running
`td` starts a server on `127.0.0.1`, prints a one-time launch URL and opens it
in the browser.

```sh
td                  # start (or reopen the running instance) and open the browser
td --no-open        # print the launch URL only
td --port 0         # pick a free port
td --help
```

The launch URL carries a single-use code that expires after 60 seconds. If it
expires, run `td` again: it reuses the running instance and prints a new URL.

Requires Node.js 22.13 or newer (or Bun) on Linux. `td` refuses to start its
server as root.

This package is not published yet; full documentation follows with the first
release.
