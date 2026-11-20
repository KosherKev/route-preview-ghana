-- Rendered street-video clips per routing edge (Valhalla graph edge id).
CREATE TABLE clips (
  clip_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_id         bigint NOT NULL,
  start_offset    double precision NOT NULL DEFAULT 0,
  end_offset      double precision NOT NULL DEFAULT 1,
  direction       text,
  video_url       text,
  length_m        double precision,
  imagery_version text,
  render_params   jsonb,
  status          text NOT NULL DEFAULT 'pending',
  start_pose      jsonb,
  end_pose        jsonb,
  expires_at      timestamptz
);
CREATE INDEX clips_edge_idx ON clips (edge_id, direction);
CREATE INDEX clips_expires_idx ON clips (expires_at);
