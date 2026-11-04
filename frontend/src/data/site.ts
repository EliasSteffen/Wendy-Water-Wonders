// The Pages workflow sets PUBLIC_REPO_URL to the repository the site is built from.
export const REPO_URL: string = import.meta.env.PUBLIC_REPO_URL || "https://github.com/EliasSteffen";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");
export const withBase = (path: string) => `${base}/${path.replace(/^\//, "")}`;
export const repoFile = (path: string) => `${REPO_URL}/blob/main/${path}`;

// Same people as AUTHORS.md and CITATION.cff, alphabetical by family name.
// github: the user name; linkedin: the part after linkedin.com/in/. Leave out what you don't have.
export const TEAM: { name: string; github?: string; linkedin?: string }[] = [
  { name: "Jolanda Bolt", github: "", linkedin: "https://www.linkedin.com/in/jolanda-bolt" },
  { name: "Merlind C. Pohl", github: "MerlindCPohl", linkedin: "https://www.linkedin.com/in/merlind-c-pohl-136299358" },
  { name: "Maximilian Schwingel", github: "m111xi", linkedin: "https://www.linkedin.com/in/maximilian-schwingel-0296052b2" },
  { name: "Elias Steffen", github: "EliasSteffen", linkedin: "https://www.linkedin.com/in/eliassteffen" },
  { name: "Andrea Stefke", linkedin: "https://www.linkedin.com/in/andrea-stefke-788938159" },
];
