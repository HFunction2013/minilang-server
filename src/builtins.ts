// Metadata for minilang built-in functions, native methods and syslib modules.
// Used by hover, completion and signature help.

export interface BuiltinDoc {
  name: string;
  signature: string;
  detail: string;
  doc: string;
}

export const BUILTINS: BuiltinDoc[] = [
  { name: 'len', signature: 'len(v)', detail: 'length', doc: 'Number of chars in a string or elements in an array.' },
  { name: 'charAt', signature: 'charAt(s, i)', detail: 'char code at index', doc: 'Byte value (0-255) at index i, or 0 when out of range.' },
  { name: 'substr', signature: 'substr(s, start, len)', detail: 'substring', doc: 'Up to len chars of s starting at start.' },
  { name: 'toString', signature: 'toString(v)', detail: 'to string', doc: 'Int to decimal text; strings pass through; nil -> "nil".' },
  { name: 'toInt', signature: 'toInt(s)', detail: 'to int', doc: 'Parse a string as an integer.' },
  { name: 'strcmp', signature: 'strcmp(a, b)', detail: 'string compare', doc: '0 when equal, <0 when a<b, >0 when a>b.' },
  { name: 'readAll', signature: 'readAll()', detail: 'read all stdin', doc: 'Reads all of stdin as a string.' },
  { name: 'array', signature: 'array(size, init)', detail: 'make array', doc: 'Array of size elements, each set to init.' },
  { name: 'argc', signature: 'argc()', detail: 'arg count', doc: 'Number of command-line arguments.' },
  { name: 'argv', signature: 'argv(i)', detail: 'arg at index', doc: 'Command-line argument i as a string.' },
  { name: 'readFile', signature: 'readFile(path)', detail: 'read file', doc: 'Read a whole file as a string.' },
  { name: 'readFileBytes', signature: 'readFileBytes(path)', detail: 'read file bytes', doc: 'Read a file as an int array (one int per byte).' },
  { name: 'fileExists', signature: 'fileExists(path)', detail: 'file exists', doc: '1 if the path can be opened, else 0.' },
  { name: 'writeFile', signature: 'writeFile(path, content)', detail: 'write file', doc: 'Write content to path; returns 1 on success.' },
  { name: 'writeFileBytes', signature: 'writeFileBytes(path, bytes)', detail: 'write bytes', doc: 'Write an int array as raw bytes.' },
  { name: 'system', signature: 'system(cmd)', detail: 'shell command', doc: 'Run cmd via the shell; returns exit code.' },
  { name: 'readLine', signature: 'readLine()', detail: 'read a line', doc: 'One line from stdin (newline stripped); "" at EOF.' },
  { name: 'chr', signature: 'chr(n)', detail: 'char from byte', doc: 'One-character string from byte value n.' },
];

// C-native methods (declared in syslib/builtin.mil, implemented in native.c)
export const NATIVES: BuiltinDoc[] = [
  { name: 'sqrt', signature: 'sqrt(n)', detail: 'integer sqrt (C native)', doc: 'Floor of sqrt(n); n<0 -> 0. Implemented in C.' },
  { name: 'abs', signature: 'abs(n)', detail: 'absolute value (C native)', doc: '|n|, implemented in C.' },
  { name: 'time', signature: 'time()', detail: 'unix time (C native)', doc: 'Seconds since the Unix epoch.' },
  { name: 'clock_ms', signature: 'clock_ms()', detail: 'monotonic ms (C native)', doc: 'Milliseconds since process start.' },
  { name: 'getenv', signature: 'getenv(name)', detail: 'env variable (C native)', doc: 'Value of an environment variable; "" if unset.' },
  { name: 'cwrite', signature: 'cwrite(s)', detail: 'write to stdout (C native)', doc: 'Write s directly to stdout; returns 1.' },
  { name: 'exit', signature: 'exit(code)', detail: 'exit process (C native)', doc: 'Terminate with the given exit code.' },
  { name: 'csystem', signature: 'csystem(cmd)', detail: 'shell command (C native)', doc: 'Run cmd via the shell; returns exit code.' },
];

export interface ModuleDoc {
  name: string;
  detail: string;
  doc: string;
  functions: BuiltinDoc[];
}

const fn = (name: string, signature: string, detail: string, doc: string): BuiltinDoc => ({ name, signature, detail, doc });

export const MODULES: ModuleDoc[] = [
  { name: 'math', detail: 'integer math', doc: 'Integer math. Trig in degrees, x1000.',
    functions: [
      fn('min', 'math.min(a,b)', 'smaller', 'Smaller of a and b.'),
      fn('max', 'math.max(a,b)', 'larger', 'Larger of a and b.'),
      fn('clamp', 'math.clamp(x,lo,hi)', 'clamp', 'Constrain x to [lo,hi].'),
      fn('pow', 'math.pow(b,e)', 'power', 'base^exp.'),
      fn('gcd', 'math.gcd(a,b)', 'gcd', 'Euclidean GCD.'),
      fn('lcm', 'math.lcm(a,b)', 'lcm', 'Least common multiple.'),
      fn('isEven', 'math.isEven(n)', 'even', '1 if n even.'),
      fn('isOdd', 'math.isOdd(n)', 'odd', '1 if n odd.'),
      fn('factorial', 'math.factorial(n)', 'n!', 'Factorial.'),
      fn('fib', 'math.fib(n)', 'fibonacci', 'nth Fibonacci.'),
      fn('cos', 'math.cos(deg)', 'cos x1000', 'Cosine in degrees, scaled by 1000.'),
      fn('sin', 'math.sin(deg)', 'sin x1000', 'Sine in degrees, scaled by 1000.'),
      fn('pi', 'math.pi()', 'pi x1000', '3142.'),
    ] },
  { name: 'string', detail: 'string utils', doc: 'Pure string helpers.',
    functions: [
      fn('isEmpty', 'string.isEmpty(s)', 'empty?', '1 if len(s)==0.'),
      fn('startsWith', 'string.startsWith(s,p)', 'prefix', '1 if s starts with p.'),
      fn('endsWith', 'string.endsWith(s,suf)', 'suffix', '1 if s ends with suf.'),
      fn('contains', 'string.contains(s,sub)', 'contains', '1 if sub in s.'),
      fn('repeat', 'string.repeat(s,n)', 'repeat', 's repeated n times.'),
      fn('reverse', 'string.reverse(s)', 'reverse', 'Reversed string.'),
      fn('split', 'string.split(s,sep)', 'split', 'Array of parts.'),
      fn('lines', 'string.lines(s)', 'lines', 'Split on newlines.'),
      fn('join', 'string.join(a,sep)', 'join', 'Join string array.'),
      fn('indexOf', 'string.indexOf(s,sub)', 'index', 'First index of sub, -1 if none.'),
      fn('toUpper', 'string.toUpper(s)', 'upper', 'Uppercase ASCII.'),
      fn('toLower', 'string.toLower(s)', 'lower', 'Lowercase ASCII.'),
      fn('trim', 'string.trim(s)', 'trim', 'Strip whitespace both ends.'),
    ] },
  { name: 'list', detail: 'array utils', doc: 'Array/list helpers.',
    functions: [
      fn('range', 'list.range(lo,hi)', 'range', '[lo,...,hi).'),
      fn('copy', 'list.copy(a)', 'copy', 'Shallow copy.'),
      fn('push', 'list.push(a,x)', 'push', 'New array with x appended.'),
      fn('pop', 'list.pop(a)', 'pop', 'New array without last.'),
      fn('first', 'list.first(a)', 'first', 'First element.'),
      fn('last', 'list.last(a)', 'last', 'Last element.'),
      fn('slice', 'list.slice(a,s,e)', 'slice', 'Half-open range.'),
      fn('concat', 'list.concat(a,b)', 'concat', 'a followed by b.'),
      fn('sum', 'list.sum(a)', 'sum', 'Sum of ints.'),
      fn('min', 'list.min(a)', 'min', 'Smallest element.'),
      fn('max', 'list.max(a)', 'max', 'Largest element.'),
      fn('contains', 'list.contains(a,x)', 'contains', '1 if x in a.'),
    ] },
  { name: 'json', detail: 'json', doc: 'JSON via tagged pairs [type,payload].',
    functions: [
      fn('parse', 'json.parse(t)', 'parse', 'Parse JSON text.'),
      fn('stringify', 'json.stringify(v)', 'stringify', 'Compact JSON.'),
      fn('pretty', 'json.pretty(v,ind)', 'pretty', 'Indented JSON.'),
      fn('get', 'json.get(v,k)', 'get', 'Member by key.'),
      fn('set', 'json.set(v,k,x)', 'set', 'Set member.'),
      fn('obj', 'json.obj()', 'new object', 'Empty JSON object.'),
      fn('arr', 'json.arr()', 'new array', 'Empty JSON array.'),
      fn('num', 'json.num(n)', 'number', 'JSON number.'),
      fn('str', 'json.str(s)', 'string', 'JSON string.'),
    ] },
  { name: 'io', detail: 'file/path', doc: 'File and path helpers.',
    functions: [
      fn('read', 'io.read(p)', 'read file', 'File text or "" if missing.'),
      fn('write', 'io.write(p,c)', 'write file', 'Write content.'),
      fn('exists', 'io.exists(p)', 'exists', '1 if path opens.'),
      fn('pathJoin', 'io.pathJoin(a,b)', 'path join', 'Join two path parts.'),
      fn('basename', 'io.basename(p)', 'basename', 'File name part.'),
      fn('dirname', 'io.dirname(p)', 'dirname', 'Directory part.'),
    ] },
  { name: 'rand', detail: 'random', doc: 'Deterministic LCG.',
    functions: [
      fn('seed', 'rand.seed(n)', 'seed', 'Set seed.'),
      fn('next', 'rand.next()', 'next', 'Next raw value.'),
      fn('int', 'rand.int(n)', 'range int', 'Random int in [0,n).'),
      fn('pick', 'rand.pick(a)', 'pick', 'Random element.'),
    ] },
];

const byModuleFn = new Map<string, BuiltinDoc>();
for (const m of MODULES) for (const f of m.functions) byModuleFn.set(`${m.name}.${f.name}`, f);
for (const n of NATIVES) byModuleFn.set(n.name, n);
const byName = new Map<string, BuiltinDoc>();
for (const b of [...BUILTINS, ...NATIVES]) byName.set(b.name, b);

export function findDoc(word: string): BuiltinDoc | null {
  return byModuleFn.get(word) ?? byName.get(word) ?? null;
}

export function allCompletions(): { label: string; doc: BuiltinDoc }[] {
  const out: { label: string; doc: BuiltinDoc }[] = [];
  for (const b of BUILTINS) out.push({ label: b.name, doc: b });
  for (const n of NATIVES) out.push({ label: n.name, doc: n });
  for (const m of MODULES) for (const f of m.functions) out.push({ label: `${m.name}.${f.name}`, doc: f });
  return out;
}
