export type ServerStatus = 'healthy' | 'unhealthy' | 'unknown';

export type Server = {
  url: string;
  name: string;
  status: ServerStatus;
  lastCheck: number;
  responseTime: number;
  jobsCount: number;
  error?: string;
};

const DEFAULT_SERVERS: Server[] = [
  {
    url: import.meta.env.VITE_SERVER_1_URL || 'https://pixelboost-backend-q659.onrender.com',
    name: 'Server 1',
    status: 'unknown',
    lastCheck: 0,
    responseTime: 0,
    jobsCount: 0,
  },
  {
    url: import.meta.env.VITE_SERVER_2_URL || '',
    name: 'Server 2',
    status: 'unknown',
    lastCheck: 0,
    responseTime: 0,
    jobsCount: 0,
  },
  {
    url: import.meta.env.VITE_SERVER_3_URL || '',
    name: 'Server 3',
    status: 'unknown',
    lastCheck: 0,
    responseTime: 0,
    jobsCount: 0,
  },
].filter((s) => s.url); // Remove empty URLs

let servers: Server[] = [...DEFAULT_SERVERS];
let selectedIndex = 0;

export function getServers(): Server[] {
  return [...servers];
}

export function getHealthyServers(): Server[] {
  return servers.filter((s) => s.status === 'healthy' || s.status === 'unknown');
}

export function getBestServer(): Server | null {
  const healthy = getHealthyServers();
  if (healthy.length === 0) {
    // Fallback to first server
    return servers[0] || null;
  }

  // Pick server with lowest jobs count (load balancing)
  return healthy.reduce((best, current) =>
    current.jobsCount < best.jobsCount ? current : best
  );
}

export async function checkServerHealth(server: Server): Promise<Server> {
  const start = Date.now();
  try {
    const res = await fetch(`${server.url}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });
    const responseTime = Date.now() - start;

    if (res.ok) {
      const data = await res.json();
      return {
        ...server,
        status: 'healthy',
        lastCheck: Date.now(),
        responseTime,
        jobsCount: data.ai_jobs_active || 0,
        error: undefined,
      };
    }

    return {
      ...server,
      status: 'unhealthy',
      lastCheck: Date.now(),
      responseTime,
      error: `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ...server,
      status: 'unhealthy',
      lastCheck: Date.now(),
      responseTime: Date.now() - start,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}

export async function checkAllServers(): Promise<Server[]> {
  const results = await Promise.allSettled(
    servers.map((s) => checkServerHealth(s))
  );

  servers = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { ...servers[i], status: 'unhealthy' as const, error: 'Health check failed' }
  );

  return [...servers];
}

export function selectNextServer(): Server | null {
  const healthy = getHealthyServers();
  if (healthy.length === 0) return null;

  selectedIndex = (selectedIndex + 1) % healthy.length;
  return healthy[selectedIndex];
}

export function resetServerSelection() {
  selectedIndex = 0;
}

export async function fetchWithFailover(
  path: string,
  options: RequestInit = {}
): Promise<{ response: Response; server: Server }> {
  const tried = new Set<string>();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const server = getBestServer();
    if (!server || tried.has(server.url)) {
      // Try any untried server
      const untried = servers.find((s) => !tried.has(s.url));
      if (!untried) break;
      return fetchFromServer(untried, path, options);
    }

    tried.add(server.url);

    try {
      const result = await fetchFromServer(server, path, options);
      if (result.response.ok || result.response.status < 500) {
        return result;
      }
      // Server error, try next
      lastError = new Error(`Server ${server.name} returned ${result.response.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Unknown error');
      // Mark server as unhealthy
      const idx = servers.findIndex((s) => s.url === server.url);
      if (idx >= 0) {
        servers[idx] = { ...servers[idx], status: 'unhealthy', error: lastError.message };
      }
    }
  }

  throw lastError || new Error('All servers unavailable');
}

async function fetchFromServer(
  server: Server,
  path: string,
  options: RequestInit
): Promise<{ response: Response; server: Server }> {
  const url = `${server.url}${path}`;
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(120000),
  });

  return { response, server };
}
