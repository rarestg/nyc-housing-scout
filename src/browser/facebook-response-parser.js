function isWhitespaceCharacter(char) {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f';
}

function skipWhitespace(text, startIndex) {
  let index = startIndex;
  while (index < text.length && isWhitespaceCharacter(text[index])) {
    index += 1;
  }
  return index;
}

function skipKnownPrefix(text, startIndex) {
  const prefixes = [
    'for (;;);',
    'for(;;);',
    'while(1);',
    'while (1);',
    ")]}'",
    ")]}',",
  ];

  for (const prefix of prefixes) {
    if (text.startsWith(prefix, startIndex)) {
      return startIndex + prefix.length;
    }
  }

  return startIndex;
}

function findNextJsonStart(text, startIndex) {
  let index = startIndex;

  while (index < text.length) {
    const afterWhitespace = skipWhitespace(text, index);
    if (afterWhitespace !== index) {
      index = afterWhitespace;
      continue;
    }

    const afterPrefix = skipKnownPrefix(text, index);
    if (afterPrefix !== index) {
      index = afterPrefix;
      continue;
    }

    const char = text[index];
    if (char === '{' || char === '[' || char === '"' || /\d/.test(char)) {
      return index;
    }

    if (char === '-' && /\d/.test(text[index + 1] || '')) {
      return index;
    }

    if (text.startsWith('true', index) || text.startsWith('false', index) || text.startsWith('null', index)) {
      return index;
    }

    if (char === ';' || char === ',') {
      index += 1;
      continue;
    }

    index += 1;
  }

  return -1;
}

function skipIgnorableText(text, startIndex, limitIndex) {
  let index = startIndex;

  while (index < limitIndex) {
    const afterWhitespace = skipWhitespace(text, index);
    if (afterWhitespace !== index) {
      index = afterWhitespace;
      continue;
    }

    const afterPrefix = skipKnownPrefix(text, index);
    if (afterPrefix !== index) {
      index = afterPrefix;
      continue;
    }

    if (text[index] === ';' || text[index] === ',') {
      index += 1;
      continue;
    }

    break;
  }

  return index;
}

function scanJsonStringEnd(text, startIndex) {
  let index = startIndex + 1;
  let escaped = false;

  while (index < text.length) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      index += 1;
      continue;
    }

    if (char === '"') {
      return index + 1;
    }

    index += 1;
  }

  throw new Error(`unterminated JSON string at index ${startIndex}`);
}

function scanJsonPrimitiveEnd(text, startIndex) {
  let index = startIndex;

  while (index < text.length) {
    const char = text[index];
    if (isWhitespaceCharacter(char) || char === ',' || char === ';' || char === ']' || char === '}') {
      return index;
    }
    index += 1;
  }

  return index;
}

function scanJsonValueEnd(text, startIndex) {
  const firstChar = text[startIndex];

  if (firstChar === '"') {
    return scanJsonStringEnd(text, startIndex);
  }

  if (firstChar !== '{' && firstChar !== '[') {
    return scanJsonPrimitiveEnd(text, startIndex);
  }

  let index = startIndex;
  let depth = 0;
  let inString = false;
  let escaped = false;

  while (index < text.length) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      index += 1;
      continue;
    }

    if (char === '{' || char === '[') {
      depth += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
      if (depth < 0) {
        throw new Error(`unexpected JSON closer at index ${index}`);
      }
    }

    index += 1;
  }

  throw new Error(`unterminated JSON document at index ${startIndex}`);
}

function trimSnippet(text, startIndex, endIndex) {
  return text
    .slice(startIndex, endIndex)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function parseFacebookResponseText(input, options = {}) {
  const includeRawText = Boolean(options.includeRawText);
  const throwOnTrailingNoise = Boolean(options.throwOnTrailingNoise);
  const text = String(input || '');
  const documents = [];
  const warnings = [];

  let index = 0;

  while (index < text.length) {
    const startIndex = findNextJsonStart(text, index);
    if (startIndex < 0) {
      const trailing = trimSnippet(text, index, text.length);
      if (trailing) {
        const warning = `ignored trailing non-JSON content near: ${trailing}`;
        if (throwOnTrailingNoise) {
          throw new Error(warning);
        }
        warnings.push(warning);
      }
      break;
    }

    if (startIndex > index) {
      const ignoredEnd = skipIgnorableText(text, index, startIndex);
      const skipped = trimSnippet(text, index, startIndex);
      if (skipped && ignoredEnd < startIndex) {
        warnings.push(`skipped non-JSON content near: ${skipped}`);
      }
    }

    let endIndex = startIndex;
    try {
      endIndex = scanJsonValueEnd(text, startIndex);
    } catch (error) {
      const snippet = trimSnippet(text, startIndex, Math.min(text.length, startIndex + 160));
      const message = `could not parse JSON near: ${snippet}; ${error.message}`;
      if (documents.length && !throwOnTrailingNoise) {
        warnings.push(message);
        break;
      }
      throw new Error(message);
    }

    const rawText = text.slice(startIndex, endIndex);
    let value = null;

    try {
      value = JSON.parse(rawText);
    } catch (error) {
      const snippet = trimSnippet(text, startIndex, Math.min(text.length, startIndex + 160));
      const message = `could not decode JSON near: ${snippet}; ${error.message}`;
      if (documents.length && !throwOnTrailingNoise) {
        warnings.push(message);
        break;
      }
      throw new Error(message);
    }

    documents.push({
      index: documents.length,
      start: startIndex,
      end: endIndex,
      value,
      ...(includeRawText ? { rawText } : {}),
    });

    index = endIndex;
  }

  return {
    textLength: text.length,
    documents,
    warnings,
  };
}

export function parseFacebookResponseDocuments(input, options = {}) {
  return parseFacebookResponseText(input, options).documents;
}
