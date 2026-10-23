// The Pages workflow sets PUBLIC_REPO_URL to the repository the site is built from.
export const REPO_URL: string = import.meta.env.PUBLIC_REPO_URL || "https://github.com/EliasSteffen";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");
export const withBase = (path: string) => `${base}/${path.replace(/^\//, "")}`;
export const repoFile = (path: string) => `${REPO_URL}/blob/main/${path}`;

// Same people as AUTHORS.md and CITATION.cff, alphabetical by family name.
// github: the user name; linkedin: the part after linkedin.com/in/. Leave out what you don't have.
export const TEAM: { name: string; github?: string; linkedin?: string }[] = [
  { name: "Jolanda Bolt" },
  { name: "Merlind C. Pohl" },
  { name: "Maximilian Schwingel", github: "m111xi" },
  { name: "Elias Steffen", github: "EliasSteffen" },
  { name: "Andrea Stefke" },
];
