/** @type {import('next').NextConfig} */
const nextConfig = {
  // Phase 13 — A2A discovery. Agent Cards live at the A2A well-known path:
  // the host-level card describes the primary exposed worker (fleet-analyst),
  // and each exposed worker also has its own card under its endpoint, so
  // `ClientFactory.createFromUrl('<origin>/api/a2a/<agent>')` just works.
  async rewrites() {
    return [
      { source: '/.well-known/agent-card.json', destination: '/api/a2a/fleet-analyst/card' },
      { source: '/api/a2a/:agent/.well-known/agent-card.json', destination: '/api/a2a/:agent/card' },
    ];
  },
};

export default nextConfig;
