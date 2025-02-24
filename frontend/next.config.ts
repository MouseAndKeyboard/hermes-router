/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    API_BASE: process.env.API_BASE || "http://localhost:8000",
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
