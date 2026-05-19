export interface ProjectInfo {
  name: string;
  description: string;
  version: string;
  status: string;
  environment: string;
  lastUpdated: string;
}

export interface AuthorInfo {
  name: string;
  role: string;
  website: string;
  github: string;
}

export interface StackInfo {
  frontend: string[];
  backend: string[];
  infrastructure: string[];
}

export interface Feature {
  title: string;
  description: string;
}

export interface LighthouseScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface PerformanceInfo {
  lighthouse: LighthouseScores;
}

export interface StatsInfo {
  components: number;
  pages: number;
  deployments: number;
}

export interface LinksInfo {
  live: string;
  repository: string;
}

export interface AboutData {
  project: ProjectInfo;
  author: AuthorInfo;
  stack: StackInfo;
  features: Feature[];
  performance: PerformanceInfo;
  stats: StatsInfo;
  links: LinksInfo;
  futurePlans: string[];
}

export interface AboutResponse {
  success: true;
  data: AboutData;
}
