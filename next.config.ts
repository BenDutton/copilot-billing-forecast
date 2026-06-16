import type { NextConfig } from "next";

// GitHub Pages serves this project site under /<repo>/. Apply the base path only
// for production builds so local `npm run dev` keeps working at the root.
const isProd = process.env.NODE_ENV === "production";
const repoBasePath = "/copilot-billing-forecast";

const nextConfig: NextConfig = {
  // Emit a fully static site into ./out for GitHub Pages.
  output: "export",
  // next/image optimization needs a server, which static export does not have.
  images: { unoptimized: true },
  // Serve pages with trailing slashes so deep links resolve as static files.
  trailingSlash: true,
  basePath: isProd ? repoBasePath : undefined,
  assetPrefix: isProd ? `${repoBasePath}/` : undefined,
};

export default nextConfig;
