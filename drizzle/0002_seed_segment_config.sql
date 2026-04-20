-- Seed memory_segment_config with the seven defaults from auto-ride-initial-plan.md §5.
-- Idempotent via ON CONFLICT (segment) DO NOTHING — safe to replay.
-- decay_lambda_short = -ln(0.92) ≈ 0.0834 (the "8% per day" intuition).

INSERT INTO "memory_segment_config"
    ("segment", "default_importance", "decay_lambda_short", "decay_lambda_long_factor",
     "promotion_threshold_long", "promotion_threshold_permanent", "fast_track_permanent")
VALUES
    ('identity',     0.90, 0.0834, 0.01, 0.50, 0.80, true),
    ('correction',   0.80, 0.0834, 0.01, 0.50, 0.80, false),
    ('preference',   0.70, 0.0834, 0.01, 0.50, 0.80, false),
    ('relationship', 0.65, 0.0834, 0.01, 0.50, 0.80, false),
    ('knowledge',    0.60, 0.0834, 0.01, 0.50, 0.80, false),
    ('behavioral',   0.55, 0.0834, 0.01, 0.50, 0.80, false),
    ('context',      0.40, 0.0834, 0.01, 0.50, 0.80, false)
ON CONFLICT ("segment") DO NOTHING;
