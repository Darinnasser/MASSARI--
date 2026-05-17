import app from "./server/app.js";

const port = process.env.PORT || 3001;

app.listen(port, () => {
  console.log(`Masari API running on http://localhost:${port} with Gemini 1.5 Flash Latest`);
});
