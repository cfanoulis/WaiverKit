require("dotenv").config();
const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs");
const { chromium } = require("@playwright/test");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const _ = require("lodash");
const moment = require("moment");
const axios = require("axios");

// Cache agreement template
const agreement = fs.readFileSync(`${__dirname}/views/agreement.ejs`, "utf8");

// Cache email subjects and content
const emailContentInternal = ejs.compile(
  fs.readFileSync(`${__dirname}/emails/internal.ejs`, "utf8")
);
const emailContentSignee = ejs.compile(
  fs.readFileSync(`${__dirname}/emails/signee.ejs`, "utf8")
);
const signeeSubject = ejs.compile(process.env.SIGNEE_EMAIL_SUBJECT || "");
const internalSubject = ejs.compile(process.env.INTERNAL_EMAIL_SUBJECT || "");
const examples = JSON.parse(
  fs.readFileSync(`${__dirname}/examples.json`, "utf8")
);

// validateConfig();

const postmark = require("postmark");
const client = new postmark.Client(
  process.env.POSTMARK_SERVER_TOKEN ?? "blahblahblah"
);

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

const viewData = {
  title: process.env.TITLE || "",
  exampleData: examples,
};

/**
 * Order code login
 */
app.get("/login", (req, res) => {
  res.render("entry", viewData);
});

/**
 * Order code login
 */
app.get("/sent", (req, res) => {
  res.render("entry", viewData);
});

/**
 * Index express route
 */
app.get("/", (req, res) => {
  res.render("index", viewData);
});

/**
 * debug route
 */

app.get("/render/:view", (req, res) => {
  res.render(req.params.view, viewData);
});

/**
 * Sign document express route
 */
app.post("/sign", async (req, res) => {
  const template = ejs.compile(agreement);
  req.body.date = moment().format("MMMM Do, YYYY");

  const pdfAgreement = await createDocument(template(req.body));
  req.body.agreement = pdfAgreement;
  res.render("success", _.merge(viewData, req.body));

  sendEmails(req.body);

  //todo: send waiver details to pretix
});

/**
 * Generate example agreement
 */
app.get("/example.pdf", async (req, res) => {
  const template = ejs.compile(agreement);
  const data = viewData.exampleData;
  data.date = moment().format("MMMM Do, YYYY");

  const pdf = await createDocument(template(data));
  res.contentType("application/pdf");
  res.end(pdf, "base64");
});

app.get("/example.html", async (req, res) => {
  const template = ejs.compile(agreement);
  const data = viewData.exampleData;
  data.date = moment().format("MMMM Do, YYYY");

  res.end(template(data));
});

/**
 * Start express server
 */
app.listen(process.env.PORT || 3000, () =>
  console.log("PactMaker is up and running!")
);

/**
 * Send emails to the signee and internal team
 * @param  {Object} data Request body data
 */
function sendEmails(data) {
  const attachment = {
    Content: data.agreement,
    Name: `Hack The Thames Liability Waiver_${data.date}.pdf`,
    ContentType: "application/pdf",
  };

  // Send email to customer
  client.sendEmail(
    {
      From: process.env.POSTMARK_FROM_ADDRESS,
      To: `${data.email}, ${data.parentEmail}`,
      Subject: signeeSubject(data),
      HtmlBody: emailContentSignee(data),
      Attachments: [attachment],
    },
    (err, results) => {
      if (err) {
        console.error(err);
        return;
      }

      console.log("Email sent:");
      console.log(results);
    }
  );

  // Send email notification to internal team
  if (process.env.INTERNAL_EMAIL_RECIPIENTS) {
    const internalRecipients = process.env.INTERNAL_EMAIL_RECIPIENTS.split(",");

    internalRecipients.forEach((email) => {
      client.sendEmail(
        {
          From: process.env.POSTMARK_FROM_ADDRESS,
          To: email,
          Subject: internalSubject(data),
          HtmlBody: emailContentInternal(data),
          Attachments: [attachment],
        },
        (err, results) => {
          if (err) {
            console.error(err);
            return;
          }

          console.log("Email sent:");
          console.log(results);
        }
      );
    });
  }
}

/**
 * Create PDF document
 * @param  {Object}   content  HTMl content content
 * @param  {Function} callback Callback containing the encoded PDF buffer
 */
async function createDocument(content, callback) {
  let dataUrl =
    "data:text/html;base64," + btoa(unescape(encodeURIComponent(content)));

  const browser = await chromium.launch({
    headless: true,
  });
  const context = await browser.newContext();

  // Create a page.
  const page = await context.newPage();

  await page.goto(dataUrl);

  const pdf = await page.pdf({
    format: "letter",
    landscape: false,
    margin: {
      top: "48px",
      bottom: "48px",
      left: "48px",
      right: "48px",
    },
  });

  return pdf.toString("base64");
}

/**
 * Validate heroku config
 */
function validateConfig() {
  if (!process.env.POSTMARK_FROM_ADDRESS) {
    throw Error("No From address specified in config");
  }
  if (!process.env.POSTMARK_SERVER_TOKEN) {
    throw Error("No Postmark server token specified in config");
  }
}
