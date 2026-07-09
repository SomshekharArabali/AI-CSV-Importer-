/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits a minimal, self-contained server in `.next/standalone` (only the
  // production node_modules a request actually needs). The Dockerfile copies
  // just that output into the runner stage instead of the full node_modules
  // tree, which keeps the production image small and avoids shipping
  // devDependencies at runtime.
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
