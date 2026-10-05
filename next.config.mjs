/** @type {import('next').NextConfig} */
const nextConfig = {
    serverExternalPackages: ['pdfkit'],
    outputFileTracingIncludes: {
        '/api/documents': ['./api/_lib/fonts/*.ttf'],
    },
};

export default nextConfig;
