/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
    // Next 16 defaults to spawning the TypeScript CLI. Node 24 can lose that
    // subprocess' piped `--showConfig` output, which makes a healthy project
    // fail the production build before any application code is checked. The
    // TypeScript API is supported by our pinned TypeScript 5.x release and
    // keeps the build's type validation intact.
    useTypeScriptCli: false,
  },
  transpilePackages: ["@traceanytong/ui", "@traceanytong/web-watermark"],
};

export default nextConfig;
