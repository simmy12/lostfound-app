// Express 4 doesn't catch rejected promises from async route handlers — an unhandled rejection
// there crashes the whole process (Node treats it as fatal). Wrap every async handler with this
// so a thrown/rejected error becomes a normal 500 response instead of taking the server down.
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
