-- KEYS[1] = the rate limit key
-- ARGV[1] = windowStart (trim everything older than this)
-- ARGV[2] = max
-- ARGV[3] = now (score for the new entry)
-- ARGV[4] = member (the finished "timestamp-suffix" string, built in TS)

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])

local count = redis.call('ZCOUNT', KEYS[1], ARGV[1], "+inf")

local allowed = 0

if count < tonumber(ARGV[2]) then
    redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
    allowed = 1
    count = count + 1

end

return {count, allowed}
