-- Rebalance economy for Fantasy VBF OP15
-- Apply this if you already have the fantasy schema running in Supabase.

update public.fantasy_vbf_seasons
set budget = 40,
    max_savings = 60,
    updated_at = timezone('utc', now())
where season = 'OP15';

-- Give existing teams the same +15 delta as the new starting budget.
-- This keeps current test teams usable without recreating them.
update public.fantasy_vbf_teams
set coins = coins + 15,
    updated_at = timezone('utc', now())
where season = 'OP15';
