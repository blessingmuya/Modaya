import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg/ffprobe installers resolve binary paths at runtime — never bundle them.
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
    "pg",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "2gb" },
  },
};

export default nextConfig;
