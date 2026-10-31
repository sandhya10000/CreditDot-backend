// Escapes user input so it is matched literally inside a RegExp (e.g. "(" or "+" in a search box)
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = escapeRegex;
