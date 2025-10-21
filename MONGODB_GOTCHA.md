# MongoDB Object _id Field Order Sensitivity

## The Problem

MongoDB treats object `_id` fields as **order-sensitive**. This means:

```javascript
{_id: {a: "root", d: "Home"}}  // Different from...
{_id: {d: "Home", a: "root"}}  // ...this!
```

These are considered **two different documents** even though they have the same fields and values.

## The Impact

When doing a PUT/upsert on the wiki, if you get the field order wrong in the `_id`, you will:
- ✅ NOT update the existing document
- ❌ CREATE a duplicate document with a different `_id` field order
- The original document remains unchanged and continues to be displayed
- Your new document becomes an orphan

## The Solution

**Always preserve the exact field order when constructing `_id` objects:**

```javascript
// Correct for wiki doclets:
{_id: {d: "PageName", a: "accountName"}}

// WRONG - will create duplicate:
{_id: {a: "accountName", d: "PageName"}}
```

## How to Avoid This

1. **Read first, update second**: Always GET the existing document first to see the exact `_id` structure
2. **Preserve field order**: When constructing updates, maintain the exact field order from the original
3. **Use string _id when possible**: Avoid compound object `_id` fields in new collections

## Cleaning Up Duplicates

If you accidentally create a duplicate:

```javascript
// Find duplicates
db.wiki.find({"_id.d": "PageName"})

// Delete the wrong one (check field order!)
db.wiki.deleteOne({_id: {a: "root", d: "PageName"}})
```

## Why This Design?

This is an arcane MongoDB behavior that's a source of time-wasting bugs. String `_id` fields would be much safer.

## TODO: Fix in wiki-mixin

**Action item**: Normalize the `_id` field order in `@metric-im/wiki-mixin` API so clients never have to worry about this.

The wiki API should:
1. Always construct `_id` as `{d: docName, a: accountName}` regardless of input order
2. Normalize any incoming `_id` objects to this canonical order before MongoDB operations
3. Document the canonical order in API docs

This would prevent this issue for all wiki hosts and clients.

---

*Documented 2025-10-14 after accidentally creating a duplicate Home page*