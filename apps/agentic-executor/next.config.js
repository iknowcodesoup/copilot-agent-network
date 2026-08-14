const path = require("node:path");

//@ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  // Next.js options go here
  // See: https://nextjs.org/docs/app/api-reference/config/next-config-js
};

module.exports = nextConfig;
