// Compatibility can take four 60s attempts (including validation repair),
// plus 3s retry backoff. Keep the socket open while its JSON response is built.
// Bun caps idleTimeout at 255s; unlike disabling it, this still bounds idle sockets.
export const HTTP_SERVER_OPTIONS = { idleTimeout: 255 } as const;
