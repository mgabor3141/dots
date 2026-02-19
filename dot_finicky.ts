import type { FinickyConfig } from "/Applications/Finicky.app/Contents/Resources/finicky.d.ts";

export default {
  options: {
    checkForUpdates: false,
    hideIcon: true,
  },
  defaultBrowser: "Zen",
  handlers: [
    {
      match: "console.cloud.google.com",
      browser: "Zen",
    },
    {
      // Open google.com and *.google.com urls in Google Chrome
      match: [
        "google.com/*", // match google.com urls
        "*.google.com*", // also match google.com subdomains
      ],
      browser: "Google Chrome",
    },
  ],
} satisfies FinickyConfig;
