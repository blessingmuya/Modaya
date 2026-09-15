import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', '@ffmpeg-installer/ffmpeg', '@ffprobe-installer/ffprobe'],
  experimental: {
    // Video uploads go browser -> S3 via signed URL, so the Next server only
    // ever sees small JSON bodies.
  },
};

export default nextConfig;
