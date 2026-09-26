import { sanitizeUntrustedText } from "@/lib/sanitize-prompt";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const MAX_REPOS = 8;
const MAX_README_CHARS = 2500;
const GITHUB_TIMEOUT_MS = 20_000;

const ROAST_PROFILE_QUERY = `
query RoastProfile($login: String!) {
  user(login: $login) {
    login
    name
    bio
    location
    websiteUrl
    url
    createdAt
    followers { totalCount }
    following { totalCount }
    repository(name: $login) {
      object(expression: "HEAD:README.md") {
        ... on Blob { text }
      }
    }
    repositories(
      first: ${MAX_REPOS}
      orderBy: { field: UPDATED_AT, direction: DESC }
      ownerAffiliations: OWNER
      privacy: PUBLIC
    ) {
      totalCount
      nodes {
        name
        description
        stargazerCount
        forkCount
        pushedAt
        primaryLanguage { name }
        repositoryTopics(first: 10) {
          nodes { topic { name } }
        }
        languages(first: 15) {
          edges { size node { name } }
        }
        object(expression: "HEAD:README.md") {
          ... on Blob { text }
        }
        defaultBranchRef {
          target {
            ... on Commit {
              history(first: 3) {
                edges {
                  node {
                    committedDate
                    messageHeadline
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

export type GitHubProfileBundle = {
  user: {
    login: string;
    name: string | null;
    bio: string | null;
    location: string | null;
    blog: string | null;
    public_repos: number;
    followers: number;
    following: number;
    created_at: string;
    html_url: string;
  };
  profileReadme: string | null;
  repos: Array<{
    name: string;
    description: string | null;
    language: string | null;
    stargazers_count: number;
    forks_count: number;
    pushed_at: string | null;
    topics: string[];
    languages: Record<string, number>;
    readmeExcerpt: string | null;
    recentCommits: Array<{ message: string; date: string }>;
  }>;
  recentEvents: Array<{ type: string; repo: string; created_at: string }>;
  languageTotals: Record<string, number>;
};

type GraphQLResponse = {
  data?: {
    user?: GraphQLUser | null;
  };
  errors?: Array<{ message: string }>;
  message?: string;
};

type GraphQLUser = {
  login: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  websiteUrl: string | null;
  url: string;
  createdAt: string;
  followers: { totalCount: number };
  following: { totalCount: number };
  repository: { object: { text?: string } | null } | null;
  repositories: {
    totalCount: number;
    nodes: Array<{
      name: string;
      description: string | null;
      stargazerCount: number;
      forkCount: number;
      pushedAt: string | null;
      primaryLanguage: { name: string } | null;
      repositoryTopics: { nodes: Array<{ topic: { name: string } }> };
      languages: {
        edges: Array<{ size: number; node: { name: string } }>;
      };
      object: { text?: string } | null;
      defaultBranchRef: {
        target: {
          history: {
            edges: Array<{
              node: {
                committedDate: string;
                messageHeadline: string;
              };
            }>;
          };
        } | null;
      } | null;
    }>;
  };
};

function githubToken(): string | undefined {
  return process.env.GITHUB_TOKEN?.trim() || undefined;
}

function githubAuthHint(): string {
  return (
    "GitHub rate limit hit. Create a token at https://github.com/settings/tokens " +
    "(public repo read is enough), add GITHUB_TOKEN=... to .env.local, restart npm run dev."
  );
}

function githubHeaders(): HeadersInit {
  const token = githubToken();
  const h: HeadersInit = {
    "Content-Type": "application/json",
    Accept: "application/vnd.github+json",
    "User-Agent": "github-profile-roaster",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function trimReadme(text: string | undefined | null): string | null {
  if (!text) return null;
  return text.slice(0, MAX_README_CHARS);
}

function mapGraphQLUser(data: GraphQLUser): GitHubProfileBundle {
  const profileReadme = trimReadme(data.repository?.object?.text ?? null);

  const repos = data.repositories.nodes.map((node) => {
    const languages: Record<string, number> = {};
    for (const edge of node.languages.edges) {
      languages[edge.node.name] = edge.size;
    }

    const recentCommits = (node.defaultBranchRef?.target?.history.edges ?? [])
      .map((e) => ({
        message: e.node.messageHeadline,
        date: e.node.committedDate,
      }))
      .filter((c) => c.message);

    return {
      name: node.name,
      description: node.description,
      language: node.primaryLanguage?.name ?? null,
      stargazers_count: node.stargazerCount,
      forks_count: node.forkCount,
      pushed_at: node.pushedAt,
      topics: node.repositoryTopics.nodes.map((t) => t.topic.name),
      languages,
      readmeExcerpt: trimReadme(node.object?.text ?? null),
      recentCommits,
    };
  });

  const languageTotals: Record<string, number> = {};
  for (const repo of repos) {
    for (const [lang, bytes] of Object.entries(repo.languages)) {
      languageTotals[lang] = (languageTotals[lang] ?? 0) + bytes;
    }
  }

  return {
    user: {
      login: data.login,
      name: data.name,
      bio: data.bio,
      location: data.location,
      blog: data.websiteUrl,
      public_repos: data.repositories.totalCount,
      followers: data.followers.totalCount,
      following: data.following.totalCount,
      created_at: data.createdAt,
      html_url: data.url,
    },
    profileReadme,
    repos,
    recentEvents: [],
    languageTotals,
  };
}

export function isValidGitHubUsername(username: string): boolean {
  if (!username || username.length > 39) return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(username);
}

async function githubGet(path: string, token?: string): Promise<Response> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-profile-roaster",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`https://api.github.com${path}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
}

async function fetchViaGraphQL(
  username: string,
  token: string
): Promise<GitHubProfileBundle | null> {
  let res: Response;
  try {
    res = await fetch(GITHUB_GRAPHQL, {
      method: "POST",
      headers: {
        ...githubHeaders(),
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      body: JSON.stringify({
        query: ROAST_PROFILE_QUERY,
        variables: { login: username },
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    throw new Error(`GitHub request failed: ${msg}`);
  }

  const body = (await res.json()) as GraphQLResponse;

  if (res.status === 401) {
    throw new Error("GitHub request failed (401)");
  }

  if (res.status === 403 || res.status === 429) {
    throw new Error(body.message?.includes("rate limit") ? githubAuthHint() : `GitHub blocked request (${res.status})`);
  }

  if (!res.ok) {
    throw new Error(`GitHub request failed (${res.status})`);
  }

  const user = body.data?.user;
  if (!user) {
    const userMissing = body.errors?.some((e) =>
      /could not resolve to a User/i.test(e.message)
    );
    if (userMissing) return null;
    if (body.errors?.length) throw new Error(body.errors[0].message);
    return null;
  }

  return mapGraphQLUser(user);
}

function decodeReadme(payload: { content?: string; encoding?: string } | null): string | null {
  if (!payload?.content || payload.encoding !== "base64") return null;
  return Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function fetchPublicProfile(username: string): Promise<GitHubProfileBundle | null> {
  const userRes = await githubGet(`/users/${encodeURIComponent(username)}`);
  if (userRes.status === 404) return null;
  if (userRes.status === 403 || userRes.status === 429) {
    throw new Error(githubAuthHint());
  }
  if (!userRes.ok) {
    throw new Error(`GitHub request failed (${userRes.status})`);
  }

  const user = (await userRes.json()) as {
    login: string;
    name: string | null;
    bio: string | null;
    location: string | null;
    blog: string | null;
    public_repos: number;
    followers: number;
    following: number;
    created_at: string;
    html_url: string;
  };

  const reposRes = await githubGet(
    `/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=${MAX_REPOS}&type=owner`
  );
  if (!reposRes.ok) {
    throw new Error(reposRes.status === 403 ? githubAuthHint() : `GitHub request failed (${reposRes.status})`);
  }
  const repoJson = await reposRes.json();
  const repoList = (Array.isArray(repoJson) ? repoJson : []) as Array<{
    name: string;
    description: string | null;
    language: string | null;
    stargazers_count: number;
    forks_count: number;
    pushed_at: string | null;
    topics?: string[];
  }>;

  const [profileReadme, details, eventsRes] = await Promise.all([
    githubGet(`/repos/${encodeURIComponent(username)}/${encodeURIComponent(username)}/readme`).then(async (res) =>
      res.ok ? decodeReadme(await res.json()) : null
    ),
    Promise.all(
      repoList.map(async (repo) => {
        const [readmeRes, commitsRes] = await Promise.all([
          githubGet(`/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo.name)}/readme`),
          githubGet(`/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo.name)}/commits?per_page=3`),
        ]);
        const readme = readmeRes.ok ? decodeReadme(await readmeRes.json()) : null;
        const commits = commitsRes.ok
          ? ((await commitsRes.json()) as Array<{
              commit?: { message?: string; author?: { date?: string } };
            }>)
          : [];
        return {
          name: repo.name,
          description: repo.description,
          language: repo.language,
          stargazers_count: repo.stargazers_count,
          forks_count: repo.forks_count,
          pushed_at: repo.pushed_at,
          topics: repo.topics ?? [],
          languages: repo.language ? { [repo.language]: 1 } : {},
          readmeExcerpt: readme,
          recentCommits: commits
            .map((commit) => ({
              message: commit.commit?.message?.split("\n")[0] ?? "",
              date: commit.commit?.author?.date ?? "",
            }))
            .filter((commit) => commit.message),
        };
      })
    ),
    githubGet(`/users/${encodeURIComponent(username)}/events/public?per_page=12`),
  ]);

  const events = eventsRes.ok
    ? ((await eventsRes.json()) as Array<{
        type?: string;
        created_at?: string;
        repo?: { name?: string };
      }>)
    : [];

  const languageTotals: Record<string, number> = {};
  for (const repo of details) {
    for (const [lang, bytes] of Object.entries(repo.languages)) {
      languageTotals[lang] = (languageTotals[lang] ?? 0) + bytes;
    }
  }

  return {
    user: {
      login: user.login,
      name: user.name,
      bio: user.bio,
      location: user.location,
      blog: user.blog,
      public_repos: user.public_repos,
      followers: user.followers,
      following: user.following,
      created_at: user.created_at,
      html_url: user.html_url,
    },
    profileReadme,
    repos: details,
    recentEvents: events
      .filter((event) => event.type && event.repo?.name && event.created_at)
      .map((event) => ({
        type: event.type as string,
        repo: event.repo?.name as string,
        created_at: event.created_at as string,
      })),
    languageTotals,
  };
}

export async function fetchGitHubProfile(
  username: string
): Promise<GitHubProfileBundle | null> {
  const token = githubToken();
  if (token) {
    try {
      return await fetchViaGraphQL(username, token);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (!message.includes("401")) throw err;
    }
  }
  return fetchPublicProfile(username);
}

export function bundleToAnalysisText(bundle: GitHubProfileBundle): string {
  const { user, profileReadme, repos, recentEvents, languageTotals } = bundle;
  const lines: string[] = [];

  lines.push(`LOGIN: ${user.login}`);
  if (user.name) lines.push(`DISPLAY NAME: ${sanitizeUntrustedText(user.name, 200)}`);
  if (user.bio) lines.push(`BIO: ${sanitizeUntrustedText(user.bio, 500)}`);
  if (user.location) lines.push(`LOCATION: ${sanitizeUntrustedText(user.location, 120)}`);
  if (user.blog) lines.push(`BLOG: ${sanitizeUntrustedText(user.blog, 300)}`);
  lines.push(
    `STATS: ${user.public_repos} public repos, ${user.followers} followers, ${user.following} following, member since ${user.created_at}`
  );

  if (profileReadme) {
    lines.push(
      "",
      "PROFILE README (special repo):",
      sanitizeUntrustedText(profileReadme, MAX_README_CHARS)
    );
  }

  const langSorted = Object.entries(languageTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([l, b]) => `${l} (${b} bytes)`)
    .join(", ");
  if (langSorted) {
    lines.push("", `LANGUAGE MIX (from sampled repos): ${langSorted}`);
  }

  lines.push("", "TOP REPOS (by recent activity):");
  for (const r of repos) {
    const desc = r.description
      ? sanitizeUntrustedText(r.description, 400)
      : "no description";
    lines.push(`- ${r.name}: ${desc}`);
    lines.push(
      `  stars ${r.stargazers_count}, forks ${r.forks_count}, primary ${r.language ?? "none"}, pushed ${r.pushed_at ?? "unknown"}`
    );
    if (r.topics.length) lines.push(`  topics: ${r.topics.join(", ")}`);
    if (r.recentCommits.length) {
      lines.push("  recent commits:");
      for (const c of r.recentCommits) {
        lines.push(
          `    [${c.date}] ${sanitizeUntrustedText(c.message, 120)}`
        );
      }
    }
    if (r.readmeExcerpt) {
      lines.push(
        "  readme excerpt:",
        sanitizeUntrustedText(r.readmeExcerpt, MAX_README_CHARS)
      );
    }
  }

  if (recentEvents.length) {
    lines.push("", "RECENT PUBLIC EVENTS:");
    for (const e of recentEvents.slice(0, 12)) {
      lines.push(`- ${e.created_at} ${e.type} on ${e.repo}`);
    }
  }

  return lines.join("\n");
}
