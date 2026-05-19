/** @type {import('next').NextConfig} */
const nextConfig = {
  // We deploy as a fully static site (HTML/JS/CSS bundle). No server routes,
  // no SSR — everything happens in the browser after page load.
  output: 'export',
  // No <Image> optimisation server, so disable runtime optimisation.
  images: { unoptimized: true },
  // trailingSlash gives us nicer paths when hosted under a static server
  // (each route becomes a directory with index.html).
  trailingSlash: true,
  // Compile shared workspace TS sources through Next's own bundler so .ts
  // files (and their .js import extensions, written for NodeNext) get
  // resolved correctly.
  transpilePackages: ['@arkiv-search/shared'],

  reactCompiler: true
};

export default nextConfig;
