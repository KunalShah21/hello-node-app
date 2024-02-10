// import express app
const express = require("express");
const app = express();

// get the port that the app should listen on
// defaults to port 3030
const port = process.env.PORT || 3030;

// on any request to /, return the hello world text
app.get("*", (req, res) => res.send("Hello World! Hi Alex"));

// setup the app to listen on the provided port
app.listen(port, (err) => {
  if (err) {
    console.log("Error::", err);
  }
  console.log(`The application app listening on port ${port}`);
});
