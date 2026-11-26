// Response sent to a blacklisted partner, at login and on any request while signed in.
// The frontend checks `code` to sign the partner out and show the message on the login page.
const ACCOUNT_SUSPENDED = {
  code: "ACCOUNT_SUSPENDED",
  message: "Your account is suspended. Please contact CreditDost support.",
};

module.exports = { ACCOUNT_SUSPENDED };
