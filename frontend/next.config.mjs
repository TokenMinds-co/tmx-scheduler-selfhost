/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared contracts package ships TypeScript-compiled CJS; transpiling it
  // here keeps one source of truth for statuses and DTOs across both apps.
  transpilePackages: ['@tmx-scheduler/shared'],
  // Linting runs from the repo root (`pnpm lint`) with the shared config;
  // `next lint` is deprecated in 15.5 and gone in 16.
  eslint: { ignoreDuringBuilds: true },
  // Bottom-left is where the sidebar's Collapse control lives, and the dev
  // overlay badge sat on top of it.
  devIndicators: { position: 'bottom-right' },
};

export default nextConfig;
