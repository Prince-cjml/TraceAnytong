/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { externalDir: true },
  transpilePackages: ["@traceanytong/ui", "@traceanytong/web-watermark"],
};

export default nextConfig;
