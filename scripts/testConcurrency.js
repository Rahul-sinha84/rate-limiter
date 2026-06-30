const callApi = async () => {
  const url = 'http://localhost:3000/api/test';
  const response = await fetch(url);
  const data = await response.json();
  return { status: response.status, data };
};

const runBurst = async (concurrency) => {
  const results = await Promise.all(Array.from({ length: concurrency }, () => callApi()));
  const allowed = results.filter((r) => r.status === 200).length;
  const rejected = results.filter((r) => r.status === 429).length;
  return { allowed, rejected };
};

const run = async () => {
  const MAX = 10; // match your limiter's configured max
  const CONCURRENCY = 20; // fire more than max, to actually stress it
  const ITERATIONS = 50;

  let violations = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    const { allowed, rejected } = await runBurst(CONCURRENCY);

    if (allowed > MAX) {
      violations++;
      console.error(`❌ iteration ${i}: allowed=${allowed} (should be <= ${MAX})`);
    } else {
      console.log(`✅ iteration ${i}: allowed=${allowed}, rejected=${rejected}`);
    }

    // let each window/key fully expire before the next iteration,
    // so iterations don't interfere with each other
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`\nDone. ${violations} violation(s) out of ${ITERATIONS} iterations.`);
  process.exit(violations > 0 ? 1 : 0);
};

run();
