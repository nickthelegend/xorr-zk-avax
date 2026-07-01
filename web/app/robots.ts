import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    sitemap: "https://app.xorr.finance/sitemap.xml",
    host: "https://app.xorr.finance",
  };
}