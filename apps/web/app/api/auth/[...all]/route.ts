const apiUrl = process.env.SHOPSMART_API_URL ?? "http://127.0.0.1:8310";

async function handler(request: Request) {
  const incomingUrl = new URL(request.url);
  const headers = new Headers();
  for (const name of ["content-type", "cookie", "origin", "referer"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const response = await fetch(
    `${apiUrl}${incomingUrl.pathname}${incomingUrl.search}`,
    {
      method: request.method,
      headers,
      ...(request.method === "GET"
        ? {}
        : { body: await request.arrayBuffer() }),
      cache: "no-store",
      redirect: "manual",
    },
  );

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export { handler as GET, handler as POST };
