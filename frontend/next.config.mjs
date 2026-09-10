/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared contracts package ships TypeScript-compiled CJS; transpiling it
  // here keeps one source of truth for statuses and DTOs across both apps.
  transpilePackages: ['@ims/shared'],
  eslint: { ignoreDuringBuilds: true },
  // Bottom-left is where the sidebar's Collapse control lives, and the dev
  // overlay badge sat on top of it.
  devIndicators: { position: 'bottom-right' },
};

export default nextConfig;
