# Karl Jr Accessibility Audit

**Date:** February 17, 2025  
**Auditor:** Kiro AI Assistant  
**Scope:** Side panel UI components

---

## Executive Summary

Karl Jr's side panel interface demonstrates strong accessibility fundamentals with semantic HTML, proper focus management, and keyboard navigation. However, several improvements would enhance the experience for users with disabilities, particularly those using screen readers.

**Overall Rating:** Good with room for improvement

---

## ✅ Strengths

### 1. Semantic HTML
- Uses proper `<button>` elements instead of divs with click handlers
- Proper heading structure in most areas
- No layout tables or misused semantic elements

### 2. Keyboard Navigation
- All interactive elements are keyboard accessible
- Focus indicators present on buttons (`focus:ring-2 focus:ring-sfgov-blue`)
- No keyboard traps identified

### 3. ARIA Implementation
- Decorative icons properly hidden with `aria-hidden="true"`
- Dismiss button includes `aria-label="Dismiss notification"`
- Good use of semantic HTML reduces need for ARIA

### 4. Visual Design
- Clear visual hierarchy
- Consistent spacing and layout
- Status messages use both color and text

### 5. No Common Pitfalls
- No images missing alt text (no `<img>` tags used)
- No unlabeled form inputs (no forms in UI)
- No auto-playing media

---

## ⚠️ Issues Identified

### Critical Priority

#### 1. Card Collapse Button Missing State Communication
**Location:** `packages/extension/src/sidepanel/components/Card.tsx` (lines 52-63)

**Issue:**  
Collapsible card headers don't communicate their expanded/collapsed state to screen readers.

**Current Code:**
```tsx
<button
    onClick={toggleExpanded}
    disabled={!collapsible}
    className={...}
>
    <div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
    </div>
    {collapsible && <svg className={...} />}
</button>
```

**Recommended Fix:**
```tsx
<button
    onClick={toggleExpanded}
    disabled={!collapsible}
    aria-expanded={isExpanded}
    aria-controls={`card-content-${title.replace(/\s+/g, "-")}`}
    className={...}
>
    <div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
    </div>
    {collapsible && <svg aria-hidden="true" className={...} />}
</button>
```

**Impact:** Screen reader users cannot determine if a card is expanded or collapsed.

---

#### 2. Error Messages Not Announced
**Location:** `packages/extension/src/sidepanel/components/A11yChecker.tsx` (line 776)

**Issue:**  
Error messages appear visually but are not announced to screen readers.

**Current Code:**
```tsx
{error && (
    <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-100">
        {error}
    </div>
)}
```

**Recommended Fix:**
```tsx
{error && (
    <div 
        role="alert"
        className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-100"
    >
        {error}
    </div>
)}
```

**Impact:** Screen reader users may not be aware when errors occur.

---

### High Priority

#### 3. Heading Hierarchy Issues
**Location:** `packages/extension/src/sidepanel/components/A11yChecker.tsx` (multiple locations)

**Issue:**  
Section headings jump from `<h2>` (card title) to `<h3>` (test sections) to `<h4>` (individual issues), but the hierarchy isn't always consistent.

**Current Code:**
```tsx
<h3 className="text-sm font-semibold text-gray-700 mb-3">Heading nesting</h3>
<h4 className="text-sm font-semibold text-gray-700">Table {issue.tableIndex}</h4>
```

**Recommended Fix:**
- Ensure Card title is `<h2>`
- Test result sections should be `<h3>`
- Individual issue titles should be `<h4>`
- Never skip heading levels

**Impact:** Screen reader users rely on heading hierarchy for navigation.

---

#### 4. Loading State Not Announced
**Location:** `packages/extension/src/sidepanel/components/A11yChecker.tsx` (line 772)

**Issue:**  
When tests are running, the loading state is only communicated visually.

**Current Code:**
```tsx
<Button
    onClick={handleRunCheck}
    disabled={isLoading}
    className="self-start"
>
    {isLoading ? <><SpinnerIcon /> Running tests...</> : buttonText}
</Button>
```

**Recommended Fix:**
```tsx
<Button
    onClick={handleRunCheck}
    disabled={isLoading}
    aria-busy={isLoading}
    className="self-start"
>
    {isLoading ? <><SpinnerIcon /> Running tests...</> : buttonText}
</Button>
```

Or add a live region:
```tsx
{isLoading && (
    <div aria-live="polite" className="sr-only">
        Running accessibility tests...
    </div>
)}
```

**Impact:** Screen reader users may not know tests are in progress.

---

### Medium Priority

#### 5. Color Contrast Verification Needed
**Location:** Multiple result components

**Issue:**  
Status messages use various color combinations that should be verified for WCAG AA compliance (4.5:1 contrast ratio).

**Colors to verify:**
- `text-gray-600` on `bg-gray-50`
- `text-blue-700` on `bg-blue-100`
- `text-green-700` on `bg-green-50`
- `text-red-700` on `bg-red-50`
- `text-amber-900` on `bg-amber-50`
- `text-purple-600` on `bg-purple-50`

**Recommended Action:**
Test all color combinations using a contrast checker tool and adjust if needed.

**Impact:** Users with low vision may have difficulty reading status messages.

---

#### 6. SVG Icons Missing Context
**Location:** `packages/extension/src/sidepanel/components/A11yChecker.tsx` (ImageAltTextResults)

**Issue:**  
Warning icon in ImageAltTextResults may convey meaning but lacks a text alternative.

**Current Code:**
```tsx
<svg 
    className="w-4 h-4 inline" 
    fill="currentColor" 
    viewBox="0 0 20 20"
    xmlns="http://www.w3.org/2000/svg"
>
    <path fillRule="evenodd" d="..." clipRule="evenodd" />
</svg>
```

**Recommended Fix:**
If the icon is decorative (meaning is conveyed by surrounding text):
```tsx
<svg aria-hidden="true" className="w-4 h-4 inline" ...>
```

If the icon conveys meaning:
```tsx
<svg role="img" aria-label="Warning" className="w-4 h-4 inline" ...>
    <title>Warning</title>
    <path fillRule="evenodd" d="..." clipRule="evenodd" />
</svg>
```

**Impact:** Screen reader users may miss visual cues.

---

### Low Priority

#### 7. List Semantics
**Location:** Multiple result components

**Issue:**  
Lists of issues use `<ul>` elements but Tailwind's reset may remove list styling, potentially affecting screen reader announcement.

**Current Code:**
```tsx
<ul className="space-y-2 text-sm text-gray-700">
    {results.vagueButtons.map((issue, index) => (
        <li key={index}>...</li>
    ))}
</ul>
```

**Recommended Fix:**
If list styling is removed, add:
```tsx
<ul className="space-y-2 text-sm text-gray-700" role="list">
```

**Impact:** Minor - screen readers may not announce items as a list.

---

## 📋 Recommendations by Priority

### Immediate (Critical)
1. Add `aria-expanded` to collapsible card buttons
2. Add `role="alert"` to error messages

### Short-term (High Priority)
3. Fix heading hierarchy throughout components
4. Add loading state announcements
5. Verify and fix color contrast issues

### Long-term (Medium/Low Priority)
6. Add appropriate labels/titles to informative SVG icons
7. Ensure list semantics are preserved

---

## Testing Recommendations

### Manual Testing
1. **Keyboard Navigation**
   - Tab through all interactive elements
   - Verify focus indicators are visible
   - Test card collapse/expand with Enter/Space

2. **Screen Reader Testing**
   - Test with NVDA (Windows) or VoiceOver (Mac)
   - Verify all content is announced
   - Check heading navigation
   - Test error and loading announcements

3. **Color Contrast**
   - Use WebAIM Contrast Checker
   - Test all text/background combinations
   - Verify WCAG AA compliance (4.5:1)

### Automated Testing
Consider adding:
- axe-core for automated accessibility testing
- eslint-plugin-jsx-a11y for catching issues during development
- Pa11y or Lighthouse CI in build pipeline

---

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [axe DevTools Browser Extension](https://www.deque.com/axe/devtools/)

---

## Conclusion

Karl Jr demonstrates solid accessibility fundamentals. Implementing the recommended fixes, particularly the critical and high-priority items, will significantly improve the experience for users with disabilities. The issues identified are common and straightforward to fix, and the codebase's clean structure makes these improvements easy to implement.
