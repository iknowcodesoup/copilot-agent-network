const path = require("node:path");

//@ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  // `next dev` (docker-compose.watch.yml) rejects a cross-origin request by
  // default. The nginx proxy in front of it forwards the browser's real
  // Host header, which is the LAN IP, not `localhost` - so that host has to
  // be allowlisted or HMR and dev asset requests get blocked. The
  // standalone production server (docker-compose.yml) has no such check, so
  // this is a no-op there.
  allowedDevOrigins: ["localhost", "10.0.0.14"],
  // Next.js options go here
  // See: https://nextjs.org/docs/app/api-reference/config/next-config-js
};

module.exports = nextConfig;
