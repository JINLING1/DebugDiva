# JavaScript 错误参考

本文档由 MDN 中文版“JavaScript 错误参考”各页面合并整理而成，用于 RAG 评测。

## Error: Permission denied to access property "x"

### 消息

```plain
Error: Permission denied to access property "x"
```

### 错误类型

错误.

### 什么地方出错了？

尝试访问无权访问的对象。这很可能出现在使用iframe元素时加载了一个不同域名下的页面，这在访问子页面时会违背同源策略。

### 示例

```html
<!doctype html>
<html>
  <head>
    <iframe
      id="myframe"
      src="http://www1.w3c-test.org/common/blank.html"></iframe>
    <script>
      console.log(document.getElementById("myframe").contentWindow.document);
      // Error: Permission denied to access property "document"
    </script>
  </head>
  <body></body>
</html>
```

可以参考

- iframe
- 同源策略

## InternalError: too much recursion

### 信息

```plain
InternalError: too much recursion
```

### 错误类型

内部错误.

### 什么地方出错了？

一个调用自身的函数被称作*递归函数*。一些情况下，递归函数类似于一个循环，都重复地执行一个代码段许多次，都需要一个条件（用于避免无尽循环或此处的无尽递归）。当出现过于深层的递归或无尽递归时，JavaScript 将会抛出此错误。

### 示例

根据递归终止的条件，该函数将递归地执行 10 次。

```js
function loop(x) {
  if (x >= 10) {
    // "x >= 10" 是递归终止条件
    return;
  }
  // 进行一些操作...
  loop(x + 1); // 递归调用
}
loop(0);
```

将递归条件设置为一个极大的数值，将不能运行：

```js
function loop(x) {
  if (x >= 1000000000000) {
    return;
  }
  // 进行一些操作...
  loop(x + 1);
}
loop(0);

// InternalError: too much recursion
```

### 相关页面

- 递归
- Recursive functions

## RangeError: argument is not a valid code point

JavaScript 异常“Invalid code point”会在 String.fromCodePoint() 方法与 NaN 值、负整数（-1）、非整数（5.4）或大于 0x10FFFF（1114111）的值一起使用时抛出。

### 错误信息

```plain
RangeError: Invalid code point -1 (V8-based)
RangeError: -1 is not a valid code point (Firefox)
RangeError: Arguments contain a value that is out of range of code points (Safari)
```

### 错误类型

RangeError

### 什么地方出错了？

String.fromCodePoint() 方法在被传入 NaN 值、负整数（-1）、非整数（5.4）或大于 0x10FFFF 的值时抛出该错误。

[码位](https://zh.wikipedia.org/wiki/码位)（code point）是 Unicode 代码空间中的数值，即范围为 `0` 到 `0x10FFFF` 的整数。

### 示例

#### 无效的示例

```js
String.fromCodePoint("_"); // RangeError
String.fromCodePoint(Infinity); // RangeError
String.fromCodePoint(-1); // RangeError
String.fromCodePoint(3.14); // RangeError
String.fromCodePoint(3e-2); // RangeError
String.fromCodePoint(NaN); // RangeError
```

#### 有效的示例

```js
String.fromCodePoint(42); // "*"
String.fromCodePoint(65, 90); // "AZ"
String.fromCodePoint(0x404); // 'Є' (U+0404)
String.fromCodePoint(0x2f804); // '你' (U+2F804)
String.fromCodePoint(194564); // '你'
String.fromCodePoint(0x1d306, 0x61, 0x1d307); // '𝌆a𝌇'
```

### 参见

- String.fromCodePoint()

## RangeError: BigInt division by zero

当一个 BigInt 被 `0n` 除时，会产生 JavaScript 异常“BigInt division by zero”。

### 错误信息

```plain
RangeError: Division by zero (V8-based)
RangeError: BigInt division by zero (Firefox)
RangeError: 0 is an invalid divisor value (Safari)
```

### 错误类型

RangeError

### 哪里出错了？

当使用除法或者取余运算符时，如果除数为 `0n` 则会触发该错误。在 Number 运算中，除以 `0n` 会得到 `Infinity`，但在 BigInt 中不存在“Infinity”这一值，因此会抛出错误。在使用除法前，请先检查除数是否为 `0n`。

### 示例

#### 被 0n 除

```js
const a = 1n;
const b = 0n;
const quotient = a / b;
// RangeError: BigInt division by zero
```

相反，应首先检查除数是否为 `0n`，并给出更友好的提示或者使用其他值，例如 `Infinity` 或 `undefined`。

```js
const a = 1n;
const b = 0n;
const quotient = b === 0n ? undefined : a / b;
```

### 参见

- `BigInt`
- 除法（`/`）
- 取余（`%`）

## RangeError: invalid array length

### 错误信息

```plain
RangeError: invalid array length (Firefox)
RangeError: Invalid array length (Chrome)
RangeError: Invalid array buffer length (Chrome)
```

### 错误类型

RangeError

### 什么地方出错了？

无效的数组错误长度通常会在以下情形中出现：

- 当创建一个长度为负数或者长度大于等于 2^32 的Array 或者 ArrayBuffer 时。
- 当设置 Array.length 属性为负数或者长度大于等于 2^32 时。

为什么 Array（数组）和 ArrayBuffer（数组缓冲区）的长度会受到限制？因为 Array 和 ArrayBuffer 的 length（长度）属性被定义为一个 32 位无符号整形（unsigned 32-bit integer）的值，所以它只能存储 0 - 2^32 - 1 之间的数。

当你使用构造函数来创建一个数组的时候，你可能想使用字面值的形式，第一个参数会被解释为数组的长度。

或者说，你想要在设置数组之前确定它的长度，或把它作为一个构造函数的参数。

### 示例

#### 错误的示例

```js
new Array(Math.pow(2, 40));
new Array(-1);
new ArrayBuffer(Math.pow(2, 32)); // 32 位系统
new ArrayBuffer(-1);

const a = [];
a.length = a.length - 1; // 将 length 属性的值设置为 -1

const b = new Array(Math.pow(2, 32) - 1);
b.length = b.length + 1; // 将 length 属性的值设置为 2^32
b.length = 2.5; // 将 length 属性设置为浮点数

const c = new Array(2.5); // 传入浮点数
```

#### 正确的示例

```js
[Math.pow(2, 40)]; // [ 1099511627776 ]
[-1]; // [ -1 ]
new ArrayBuffer(Math.pow(2, 32) - 1);
new ArrayBuffer(Math.pow(2, 33)); // 64-bit systems after Firefox 89
new ArrayBuffer(0);

const a = [];
a.length = Math.max(0, a.length - 1);

const b = new Array(Math.pow(2, 32) - 1);
b.length = Math.min(0xffffffff, b.length + 1);
// 0xffffffff 0xffffffff 是 2^32 - 1 的十六进制表示方式
// 它也可以被写作 (-1 >>> 0)

b.length = 3;

const c = new Array(3);
```

### 参见

- Array
- Array.length
- ArrayBuffer

## RangeError: invalid date

### 消息

```plain
范围错误：非法数据 (Firefox)
范围错误：非法时间值 (Chrome)
范围错误：提供的数据不是有效的 (Chrome)
```

### 错误类型

RangeError

### 哪里出错了？

为 Date 或 Date.parse() 提供了一个会导致无效日期的字符串。

### 示例

#### 错误示例

ISO 格式化字符串中不可识别的字符串或者包含非法元素值的日期一般会返回 NaN。然而，根据实现的不同，不符合 ISO 格式的字符串可能也会抛出 `RangeError: invalid date`，比如在火狐浏览器中有以下情形：

```js
new Date("foo-bar 2014");
new Date("2014-25-23").toISOString();
new Date("foo-bar 2014").toString();
```

然而下面这种情形会返回 NaN ：

```js
Date.parse("foo-bar 2014"); // NaN
```

参见 Date.parse() 文档，了解更多详情。

#### 正确示例

```js
new Date("05 October 2011 14:48 UTC");
```

### 参见

- Date
- Date.prototype.parse()
- Date.prototype.toISOString()

## RangeError: precision is out of range

### 描述

```plain
RangeError: precision {0} out of range (Firefox)
RangeError: toExponential() argument must be between 0 and 20 (Chrome)
RangeError: toFixed() digits argument must be between 0 and 20 (Chrome)
RangeError: toPrecision() argument must be between 1 and 21 (Chrome)
```

### 错误类型

RangeError

### 什么地方出错了？

以下的某个方法传入了一个超出精度范围的参数：

- Number.prototype.toExponential()
- Number.prototype.toFixed()
- Number.prototype.toPrecision()

通常这些方法允许的参数范围介于 0 和 20（或 21）之间。需要注意的是，ECMAScript 标准是允许扩展这个范围的。

| Method                                         | Firefox (SpiderMonkey) | Chrome, Opera (V8) |
| ---------------------------------------------- | ---------------------- | ------------------ |
| Number.prototype.toExponential() | 0 to 100               | 0 to 20            |
| Number.prototype.toFixed()       | -20 to 100             | 0 to 20            |
| Number.prototype.toPrecision()   | 1 to 100               | 1 to 21            |

### 示例

#### 错误的示例

```js
(77.1234).toExponential(-1); // RangeError
(77.1234).toExponential(101); // RangeError

(2.34).toFixed(-100); // RangeError
(2.34).toFixed(1001); // RangeError

(1234.5).toPrecision(-1); // RangeError
(1234.5).toPrecision(101); // RangeError
```

#### 正确的示例

```js
(77.1234).toExponential(4); // 7.7123e+1
(77.1234).toExponential(2); // 7.71e+1

(2.34).toFixed(1); // 2.3
(2.35).toFixed(1); // 2.4 (note that it rounds up in this case)

(5.123456).toPrecision(5); // 5.1235
(5.123456).toPrecision(2); // 5.1
(5.123456).toPrecision(1); // 5
```

### 相关页面

- Number.prototype.toExponential()
- Number.prototype.toFixed()
- Number.prototype.toPrecision()

## RangeError: radix must be an integer

JavaScript 异常“radix must be an integer at least 2 and no greater than 36”会在 Number.prototype.toString() 或 BigInt.prototype.toString() 方法的可选 `radix` 参数被指定，但其值不在 2 到 36 之间时触发。

### 消息

```plain
RangeError: toString() radix argument must be between 2 and 36（基于 V8 & Safari）
RangeError: radix must be an integer at least 2 and no greater than 36（Firefox）
```

### 错误类型

RangeError

### 什么地方出错了？

Number.prototype.toString() 或 BigInt.prototype.toString() 方法的可选 `radix` 参数已被指定。它的值必须是一个介于 2 到 36 之间的整数，用于指定表示数值时所使用的进制。例如，十进制（基数 10）数字 169 在十六进制（基数 16）中表示为 A9。

为什么该参数的值仅限于 36？大于 10 的基数使用字母字符作为数字；因此，基数不能大于 36，因为拉丁字母表（英语和许多其他语言使用的字母表）只有 26 个字符。

最常见的基数：

- 2 表示[二进制数](https://zh.wikipedia.org/zh-cn/二进制)、
- 8 表示[八进制数](https://zh.wikipedia.org/zh-cn/八进制)、
- 10 表示[十进制数](https://zh.wikipedia.org/zh-cn/十进制)、
- 16 表示[十六进制数](https://zh.wikipedia.org/zh-cn/十六进制)。

### 示例

#### 无效示例

```js
(42).toString(0);
(42).toString(1);
(42).toString(37);
(42).toString(150);
// 不能使用这样的字符串进行格式化：
(12071989).toString("MM-dd-yyyy");
```

#### 有效示例

```js
(42).toString(2); // “101010”（二进制）
(13).toString(8); // “15”（八进制）
(0x42).toString(10); // “66”（十进制）
(100000).toString(16); // “186a0”（十六进制）
```

### 参见

- Number.prototype.toString()
- BigInt.prototype.toString()

## RangeError: repeat count must be less than infinity

### 信息

```plain
RangeError: repeat count must be less than infinity and not overflow maximum string size (Firefox)

RangeError: Invalid count value (Chrome)
```

### 错误类型

RangeError

### 发生了什么？

代码中使用了 String.prototype.repeat() 方法。它有一个计数参数，表示重复该字符串的次数。该参数必须在 0 及正 Infinity 之间，且不能为负数。该值的合法范围可以这样表示： \[0, +∞)。

其结果字符串也不能长于最大字符串，不同 JavaScript 引擎中可能有所不同。在 Firefox（SpiderMonkey）里最大字符串大小为 2<sup>30</sup> - 2（约 2GiB）。

### 示例

#### 无效的

```js
"abc".repeat(Infinity); // RangeError
"a".repeat(2 ** 30); // RangeError
```

#### 有效的

```js
"abc".repeat(0); // ''
"abc".repeat(1); // 'abc'
"abc".repeat(2); // 'abcabc'
"abc".repeat(3.5); // 'abcabcabc'（可以被转换为整数）
```

### 参见

- String.prototype.repeat()

## RangeError: repeat count must be non-negative

### 信息

```plain
RangeError: repeat count must be non-negative (Firefox)
RangeError: Invalid count value (Chrome)
```

### 错误类型

RangeError

### 发生了什么？

代码中使用了 String.prototype.repeat()方法。它有一个计数参数，表示重复该字符串的次数。该参数必须在 0 及正 Infinity 之间，且不能为负数。该值的合法范围可以这样表示： \[0, +∞)。

### 示例

#### 无效的

```js
"abc".repeat(-1); // RangeError
```

#### 有效的

```js
"abc".repeat(0); // ''
"abc".repeat(1); // 'abc'
"abc".repeat(2); // 'abcabc'
"abc".repeat(3.5); // 'abcabcabc' (count will be converted to integer)
```

### See also

- String.prototype.repeat()

## ReferenceError: "x" is not defined

当某个地方引用了一个不存在的变量时，就会出现“_variable_ is not defined”JavaScript 异常。

### 错误信息

```plain
ReferenceError: "x" is not defined (V8-based & Firefox)
ReferenceError: Can't find variable: x (Safari)
```

### 错误类型

ReferenceError。

### 什么地方出错了？

在某处引用了一个不存在的变量。需要声明该变量，或确保它在当前脚本或作用域中可用。

> [!NOTE]
> 在加载库（例如 jQuery）时，确保在访问库变量（例如“$”）之前先加载该库。将加载库的 script 元素放在使用该库的代码之前。

### 示例

#### 未声明的变量

```js
foo.substring(1); // ReferenceError: foo is not defined
```

“foo”变量在任何地方都没有定义。它需要是一个字符串，以便 String.prototype.substring() 方法能够正常工作。

```js
const foo = "bar";
foo.substring(1); // "ar"
```

#### 错误的作用域

变量需要在当前执行上下文中可用。在函数内部定义的变量无法在函数外部访问，因为该变量只在函数的作用域内定义。

```js
function numbers() {
  const num1 = 2;
  const num2 = 3;
  return num1 + num2;
}

console.log(num1); // ReferenceError num1 is not defined.
```

然而，函数可以访问在其定义的作用域内定义的所有变量和函数。换句话说，定义在全局作用域中的函数可以访问在全局作用域中定义的所有变量。

```js
const num1 = 2;
const num2 = 3;

function numbers() {
  return num1 + num2;
}

console.log(numbers()); // 5
```

### 参见

- 作用域
- JavaScript 指南中的变量声明
- JavaScript 指南中的函数作用域

## ReferenceError: assignment to undeclared variable "x"

### 信息

```plain
ReferenceError: assignment to undeclared variable "x" (Firefox)
ReferenceError: "x" is not defined (Chrome)
ReferenceError: Variable undefined in strict mode (Edge)
```

### 错误类型

仅在严格模式中出现 ReferenceError 警告。

### 发生了什么？

在代码里赋值了一个未声明的变量。换句话说，有处没有带着 `var` 关键字的赋值。事实上已声明的和未声明的变量之间有一些差异，这可能会导致意想不到的结果，这就是为什么 JavaScript 在严格模式打印出这种错误。

关于已声明和未声明的变量，其有三个注意事项：

- 已声明的变量被约束在其执行上下文中。未声明的变量总是全局的。
- 已声明的变量在执行任何代码之前就创建了。未声明的变量则不存在，直到执行相关的代码。
- 已声明的变量是其执行上下文（函数或全局）的不可配置属性。而未声明的变量是可配置的（例如可以删除）。

更多信息及例子，请参考 `var` 页面。

关于未声明变量的赋值的错误仅在严格模式里出现。在非严格模式中，这些将被忽略。

### 示例

#### 无效的

在本例中，"bar" 是未声明的变量。

```js
function foo() {
  "use strict";
  bar = true;
}
foo(); // ReferenceError: assignment to undeclared variable bar
```

#### 有效的

为了使 "bar" 是一个已声明变量，你需要在其前面加一个 var 关键字。

```js
function foo() {
  "use strict";
  var bar = true;
}
foo();
```

### 相关

- Strict mode

## ReferenceError: can't access lexical declaration`X' before initialization

### 消息提示

```plain
ReferenceError: assignment to undeclared variable "x" (Firefox)
```

### 错误类型

ReferenceError

### 哪里出错了？

词法变量在初始化之前被访问。该错误可以发生于任何语句块中，当使用 let 或 const 修饰的变量在初始化之前被访问的时候。

### 示例

#### 非法情况

在这个例子中，变量 "foo" 在语句块中再次声明，导致未初始化。

```js
function test() {
  let foo = 33;
  if (true) {
    let foo = foo + 55; // ReferenceError: can't access lexical declaration `foo' before initialization
  }
}
test();
```

#### 正确情况

在 if 语句块中修改变量 "foo" 的值，不应该在其中进行二次声明。

```js
function test() {
  let foo = 33;
  if (true) {
    foo = foo + 55;
  }
}
test();
```

### 相关内容

- let 的暂存死区及相关错误

## ReferenceError: deprecated caller or arguments usage

### 信息

```plain
Warning: ReferenceError: deprecated caller usage (Firefox)
Warning: ReferenceError: deprecated arguments usage (Firefox)
TypeError: 'callee' and 'caller' cannot be accessed in strict mode. (Safari)
```

### 错误类型

仅在严格模式下出现的 ReferenceError 警告。JavaScript 的执行将不会停止。

### 发生了什么？

在 strict mode 中，Function.caller 和 Function.arguments 属性是不该使用的。它们都是已经被废弃的了，因为这两者泄露了函数的调用者，是不标准的，难于优化和有这潜在的性能问题。

### 实力

#### 废弃的 `function.caller` or `arguments.callee.caller`

Function.caller 和 `arguments.callee.caller` 都是已废弃的 (详见参考文章)。

```js
"use strict";

function myFunc() {
  if (myFunc.caller == null) {
    return "The function was called from the top!";
  } else {
    return "This function's caller was " + myFunc.caller;
  }
}

myFunc();
// Warning: ReferenceError: deprecated caller usage
// "The function was called from the top!"
```

#### `Function.arguments`

Function.arguments 已被废弃。 (详见参考文章)。

```js
"use strict";

function f(n) {
  g(n - 1);
}

function g(n) {
  console.log("before: " + g.arguments[0]);
  if (n > 0) {
    f(n);
  }
  console.log("after: " + g.arguments[0]);
}

f(2);

console.log("returned: " + g.arguments);
// Warning: ReferenceError: deprecated arguments usage
```

### 相关

- Deprecated and obsolete features
- Strict mode
- Function.arguments
- Function.caller and `arguments.callee.caller`

## SyntaxError: "0"-prefixed octal literals are deprecated

仅在 JavaScript 严格模式下出现的异常“0-prefixed octal literals are deprecated; use the "0o" prefix instead”在使用了已被弃用的八进制字面量（`0` 后跟数字）时出现。

### 错误提示

```plain
SyntaxError: Octal literals are not allowed in strict mode. (V8-based)
SyntaxError: Decimals with leading zeros are not allowed in strict mode. (V8-based)
SyntaxError: Unexpected number (V8-based)
SyntaxError: "0"-prefixed octal literals are deprecated; use the "0o" prefix instead (Firefox)
SyntaxError: Decimal integer literals with a leading zero are forbidden in strict mode (Safari)
```

### 错误类型

语法错误（SyntaxError），只出现于严格模式下。

### 哪里出错了？

八进制字面量已被弃用。在十进制整数前加上 `0` 时，实际上会将其转换为八进制字面量，这可能会令人感到惊讶。标准化的语法使用前导零后跟一个小写或大写的拉丁字母“O”（`0o` 或 `0O`）。

前导零总是被禁止的，即使字面量不是有效的八进制字面量语法（例如字面量包含数字 `8` 或 `9`，或者有小数点）。数字字面量仅在其值为 0 时才能以 `0` 开头。

### 示例

#### 前导“0”形式的八进制字面量

```js
"use strict";

03;

// SyntaxError: "0"-prefixed octal literals are deprecated; use the "0o" prefix instead
```

#### 有效的八进制数字

使用前导零后跟字母“o”或“O”：

```js
0o3;
```

### 参见

- 词法语法

## SyntaxError: "use strict" not allowed in function with non-simple parameters

### 信息

```plain
Firefox:
句法错误："use strict" 不允许在带默认参数的函数中
句法错误："use strict" 不允许在带 rest 参数的函数中
句法错误："use strict" 不允许在带解构参数的函数中

Chrome:
句法错误：非法的'use strict'指令，在带有非简单参数列表的函数中
```

### 错误类型

SyntaxError.

### 哪里出错了？

在函数顶部直接写了 `"use strict"` ，而该函数拥有以下的参数其中之一：

- 默认参数
- 剩余参数
- 解构

根据 ECMAScript 规范，不允许在这些函数的顶部使用“use strict”指令。

### 示例

#### 函数语句

在这种情况下，函数 sum 具有默认参数 a = 1 和 b = 2：

```js
function sum(a=1, b=2) {
  // SyntaxError: "use strict" not allowed in function with default parameter
  "use strict";
  return a + b;
}
```

如果这个函数应该处于 strict mode，并且整个脚本或封装函数也可以在严格模式下，可以移动 "use strict" 指令到函数之外：

```js
"use strict";
function sum(a = 1, b = 2) {
  return a + b;
}
```

#### 函数表达式

函数表达式可以使用另一种解决方法：

```js
var sum = function sum([a, b]) {
  // SyntaxError: "use strict" not allowed in function with destructuring parameter
  "use strict";
  return a + b;
};
```

这可以转换为以下表达式：

```js
var sum = (function () {
  "use strict";
  return function sum([a, b]) {
    return a + b;
  };
})();
```

#### 箭头函数

如果箭头函数需要访问 `this`，则可以将箭头函数作为封闭函数来使用：

```js
var callback = (...args) => {
  // SyntaxError: "use strict" not allowed in function with rest parameter
  "use strict";
  return this.run(args);
};
```

这可以转换为以下表达式：

```js
var callback = (() => {
  "use strict";
  return (...args) => {
    return this.run(args);
  };
})();
```

### 参见

- Strict mode
- 函数语句
- 函数表达式
- 默认参数
- 剩余参数
- 解构参数

## SyntaxError: "x" is a reserved identifier

### 消息提示

```plain
SyntaxError: "x" is a reserved identifier (Firefox)
SyntaxError: Unexpected reserved word (Chrome)
```

### 错误类型

SyntaxError

### 哪里出错了？

保留字 用作标记符将会出错。这些标记符在严格模式和非严格模式下保留：

- `enum`

以下标记符只会在严格模式下才作为保留字：

- `implements`
- `interface`
- let
- `package`
- `private`
- `protected`
- `public`
- `static`

### 示例

#### 严格与非严格模式下的保留字

在两种模式下，`enum` 标识符都会作为保留字。

```js
var enum = { RED: 0, GREEN: 1, BLUE: 2 };
// SyntaxError: enum is a reserved identifier
```

在严格模式下，会有更多的保留字。

```js
"use strict";
var package = ["potatoes", "rice", "fries"];
// SyntaxError: package is a reserved identifier
```

你需要对上述变量重新命名。

```js
var colorEnum = { RED: 0, GREEN: 1, BLUE: 2 };
var list = ["potatoes", "rice", "fries"];
```

#### 升级旧版本浏览器

假如你还在使用尚未支持 let 或 class 等特性的旧版本浏览器，你应该将它们升级到支持这些新语言特性的版本。

```js
"use strict";
class DocArchiver {}

// SyntaxError: class is a reserved identifier
//（只会在旧版本浏览器中抛出，例如 Firefox 44 或更老的版本）
```

### 相关内容

- [Good variable names](https://wiki.c2.com/?GoodVariableNames)

## SyntaxError: a declaration in the head of a for-of loop can't have an initializer

### 错误信息

```plain
SyntaxError: a declaration in the head of a for-of loop can't have an initializer (Firefox)

SyntaxError: for-of loop variable declaration may not have an initializer. (Chrome)
```

### 错误类型

SyntaxError

### 哪里出错了？

for...of 循环的头部包含有初始化表达式。也就是对一个变量进行声明并赋值 |`for (var i = 0 of iterable)`|。这在 for-of 循环中是被禁止的。你想要的可能是允许包含初始化器的 `for` 循环形式。

### 示例

#### 非法的 `for-of` 循环形式

```js
let iterable = [10, 20, 30];

for (let value = 50 of iterable) {
  console.log(value);
}

// SyntaxError: a declaration in the head of a for-of loop can't
// have an initializer
```

#### 合法的 `for-of` 循环形式

需要将初始化器 (`value = 50`) 从`for-of` 循环的头部移除。或许你的本意是给每个值添加 50 的偏移量，在这种情况下，可以在循环体中进行添加。

```js
let iterable = [10, 20, 30];

for (let value of iterable) {
  value += 50;
  console.log(value);
}
// 60
// 70
// 80
```

### 相关内容

- `for...of`
- `for...in` – 在严格模式下也同样禁止使用初始化器 (SyntaxError: for-in loop head declarations may not have initializers)
- `for` – 在迭代时允许定义初始化器

## SyntaxError: applying the 'delete' operator to an unqualified name is deprecated

### 错误提示

```plain
SyntaxError: applying the 'delete' operator to an unqualified name is deprecated (Firefox)
SyntaxError: Delete of an unqualified identifier in strict mode. (Chrome)
```

### 错误类型

SyntaxError 仅出现在严格模式下。

### 哪里出错了？

在 JavaScript 中，普通变量是不能通过 `delete` 操作符来删除的。在严格模式下，试图去删除一个变量会报错，这是不允许的。

delete 操作符只能用于删除对象中的属性。只有可配置的对象属性才“符合”被删除的条件。

与一般流行的观点相反的是，delete 操作符与直接释放内存**无关**。内存管理是通过切断引用来间接实现的。可以参考内存管理页面与 delete 操作符页面来获取更多的细节信息。

这个错误提示只出现于严格模式。在非严格模式下，该操作返回 false。

### 示例

在 JavaScript 中，普通变量是不能删除的，在严格模式下会报错：

```js
"use strict";

var x;

// ...

delete x;

// SyntaxError: applying the 'delete' operator to an unqualified name
// is deprecated
```

要释放变量引用的内容，可以将变量值设置为 null:

```js
"use strict";

var x;

// ...

x = null;

// x can be garbage collected
```

### 相关内容

- `delete`
- 内存管理
- TypeError: property "x" is non-configurable and can't be deleted

## SyntaxError: for-in loop head declarations may not have initializers

### 错误提示

```plain
SyntaxError: for-in loop head declarations may not have initializers (Firefox)

SyntaxError: for-in loop variable declaration may not have an initializer. (Chrome)
```

### 错误类型

该 SyntaxError 只出现于严格模式下。

### 哪里出错了？

在 for...in 循环的头部存在初始化表达式。也就是存在变量声明并且被赋值，例如 |`for (var i = 0 in obj)`|。在非严格模式下，这种在循环头部的变量声明会被静默忽略，语句的表现形式与 `|for (var i in obj)|`相同。而在严格模式下，会报语法错误。

### 示例

下面这个示例会报语法错误（`SyntaxError`）：

```js
const obj = { a: 1, b: 2, c: 3 };

for (const i = 0 in obj) {
  console.log(obj[i]);
}

// SyntaxError: for-in loop head declarations may not have initializers
```

#### 合法的 for-in 循环

可以把初始化语句 (`i = 0`) 从 for-in 循环的头部移除。

```js
"use strict";

var obj = { a: 1, b: 2, c: 3 };

for (var i in obj) {
  console.log(obj[i]);
}
```

#### 数组迭代

for...in 循环不应该应用于数组迭代中。是否考虑使用 `for` 循环而不是 `for-in` 循环来遍历数组（Array）？在 for 循环中是允许使用初始化语句的：

```js
var arr = ["a", "b", "c"];

for (var i = 2; i < arr.length; i++) {
  console.log(arr[i]);
}

// "c"
```

### 相关内容

- `for...in`
- `for...of` – 无论是在严格模式下还是非严格模式下也都不允许使用初始化语句。
- `for` – 更适用于数组迭代，因为允许使用初始化语句。

## SyntaxError: function statement requires a name

### 错误提示

```plain
SyntaxError: function statement requires a name [Firefox]
SyntaxError: Unexpected token ( [Chrome]
```

### 错误类型

SyntaxError

### 哪里出错了？

函数声明需要提供函数名称。你需要检查函数是如何定义的，是否需要为其提供名称，出现问题的函数是否需要声明为函数表达式或立即调用函数表达式（IIFE），以及函数在上下文环境中出现的位置是否正确。

### 示例

#### 语句与表达式

函数语句（或函数声明）需要命名，以下写法是不正确的：

```js
function () {
  return 'Hello world';
}
// SyntaxError: function statement requires a name
```

你可以使用函数表达式（赋值）来代替：

```js
var greet = function () {
  return "Hello world";
};
```

者是你想将其作为立即调用函数表达式（[IIFE](https://en.wikipedia.org/wiki/Immediately-invoked_function_expression)，Immediately Invoked Function Expression），也就是定义后立即执行的函数。在这种情况下你需要用到更多的括号：

```js
(function () {})();
```

#### 标号函数 (Labeled functions)

你使用函数标号 (labels)的时候，也需要在关键词 `function` 后面提供一个函数名称。这样的代码是不能运行的：

```js
function Greeter() {
  german: function () {
    return "Moin";
  }
}
// SyntaxError: function statement requires a name
```

这个例子可以正常运行：

```js
function Greeter() {
  german: function g() {
    return "Moin";
  }
}
```

#### 对象方法

如果你想创建创建一个对象方法，那么需要首先创建一个对象。以下语法（function 关键字后面没有提供名称）是合法的：

```js
var greeter = {
  german: function () {
    return "Moin";
  },
};
```

#### 回调函数的语法

另外，如果使用到了回调函数，那么检查一下语法是否正确。大括号与逗号很容易使情况变糟。

```js
promise.then(
  function() {
    console.log("success");
  });
  function() {
    console.log("error");
}
// SyntaxError: function statement requires a name
```

正确的形式应该是这样的：

```json
promise.then(
  function() {
    console.log("success");
  },
  function() {
    console.log("error");
  }
);
```

### 相关内容

- Functions in the JavaScript Guide
- function statement
- function expression
- [IIFE](https://en.wikipedia.org/wiki/Immediately-invoked_function_expression)
- label

## SyntaxError: identifier starts immediately after numeric literal

当标识符以数字开头时，JavaScript 会出现“identifier starts immediately after numeric literal”的异常。标识符只能以字母、下划线（\_）或美元符号（$）开头。

### 错误信息

```plain
SyntaxError: Unexpected identifier after numeric literal (Edge)
SyntaxError: identifier starts immediately after numeric literal (Firefox)
SyntaxError: Unexpected number (Chrome)
```

### 错误类型

SyntaxError

### 什么地方出错了？

变量的名称（也称为标识符）需遵循特定的规则，而这些规则是你的代码必须遵循的！

JavaScript 标识符必须以字母、下划线（\_）或美元符号（$）开头。不能以数字开头！只有后续的字符可以是数字（0-9）。

### 示例

#### 以数字文字开头的变量名

在 JavaScript 中，变量名不能以数字开头。以下表达式会失败：

```js
const 1life = "foo";
// SyntaxError: identifier starts immediately after numeric literal

const foo = 1life;
// SyntaxError: identifier starts immediately after numeric literal

alert(1.foo);
// SyntaxError: identifier starts immediately after numeric literal
```

你需要重新命名变量以避免前导数字。

```js
const life1 = "foo";
const foo = life1;
```

### 参见

- 词法语法
- 语法与类型指南

## SyntaxError: illegal character

### 错误提示

```plain
SyntaxError: illegal character (Firefox)
SyntaxError: Invalid or unexpected token (Chrome)
```

### 错误类型

SyntaxError

### 哪里出错了？

在代码中有非法的或者不期望出现的标记符号出现在不该出现的位置。请使用支持语法高亮功能的编辑器仔细检查你的代码，看看是否存在张冠李戴的情况，比如减号 (`-`) 与连接符 (`–`) ，或者是英文双引号 (`"`) 与中文双引号 (`“`)。

### 示例

#### 错配字符

一些字符看起来会很相像，但是会导致于语法解析器解析代码失败。

```js
“This looks like a string”;
// SyntaxError: illegal character

42 – 13;
// SyntaxError: illegal character
```

下面这样是可以正常运行的：

```js
"This is actually a string";

42 - 13;
```

#### 遗漏的字符

很容易就会在这里或那里遗漏一些字符。

```js
var colors = ['#000', #333', '#666'];
// SyntaxError: illegal character
```

把遗漏的引号给 '#333' 添加上。

```js
var colors = ["#000", "#333", "#666"];
```

#### 隐藏字符

当从外部复制粘贴代码的时候，有可能就有非法的隐藏字符的存在，需要引起注意！

```js
var foo = 'bar';​
// SyntaxError: illegal character
```

当使用文本编辑器如 VIM 进行探测的时候，可以发现这里存在一个零宽空格 [(ZWSP) (U+200B)](https://en.wikipedia.org/wiki/Zero-width_space)。

```js
var foo = 'bar';​<200b>
```

### 相关内容

- Lexical grammar

## SyntaxError: invalid assignment left-hand side

当在代码中出现意外的赋值情况时，JavaScript 就会抛出“invalid assignment left-hand side”的异常。当使用单个 `=` 符号而不是 `==` 或 `===` 时，可能会触发此异常。

### 错误信息

```plain
SyntaxError: Invalid left-hand side in assignment (V8-based)
SyntaxError: invalid assignment left-hand side (Firefox)
SyntaxError: Left side of assignment is not a reference. (Safari)
```

### 错误类型

SyntaxError 或 ReferenceError，根据语法情况来定。

### 什么地方出错了？

在某处出现了意外的赋值情况。比如说，这可能是因为赋值运算符与相等运算符不匹配。单个 `=` 符号用于给变量赋值，而 `==` 或 `===` 运算符则是用于比较值。

### 示例

#### 典型的无效赋值情况

```js
if (Math.PI + 1 = 3 || Math.PI + 1 = 4) {
  console.log("没门！");
}
// SyntaxError: invalid assignment left-hand side

const str = "你好，" += "你是在" += "找我吗？";
// SyntaxError: invalid assignment left-hand side
```

在 `if` 语句中，你需要使用严格相等运算符（`===`），而对于字符串拼接，则需要使用加号（`+`）运算符。

```js
if (Math.PI + 1 === 3 || Math.PI + 1 === 4) {
  console.log("没门！");
}

const str = "你好，" + "来自" + "另一个世界！";
```

#### 导致 ReferenceError 的赋值操作

无效的赋值操作不一定会产生语法错误。有时语法几乎是正确的，但在运行过程中，左侧表达式计算得出的是一个*值*而非*引用*，因此赋值仍然无效。这类错误会在程序执行到该语句时发生，即在实际执行阶段出现。

```js
function foo() {
  return { a: 1 };
}
foo() = 1; // ReferenceError: invalid assignment left-hand side
```

函数调用、`new` 调用、`super()` 和 `this` 都是值而不是引用。如果你想在左侧使用它们，赋值目标需要是它们产生的属性值。

```js
function foo() {
  return { a: 1 };
}
foo().a = 1;
```

> [!NOTE]
> 在 Firefox 和 Safari 中，第一个示例在非严格模式下会产生 `ReferenceError` 错误，而在严格模式下则会产生 `SyntaxError` 错误。Chrome 在严格模式和非严格模式下都会抛出运行时的 `ReferenceError` 错误。

#### 使用可选链运算符作为赋值目标

可选链运算符不是有效的赋值目标。

```js
obj?.foo = 1; // SyntaxError: invalid assignment left-hand side
```

相反，你必须首先处理可能为空值的情况。

```js
if (obj) {
  obj.foo = 1;
}
```

### 参见

- 赋值运算符
- 相等运算符

## SyntaxError: invalid regular expression flag "x"

### 信息

```plain
SyntaxError: invalid regular expression flag "x" (Firefox)
SyntaxError: Invalid regular expression flags (Chrome)
```

### 错误类型

语法错误.

### 什么地方出错了？

在代码中出现了无效的正则表达式的标记。在一个正则表达式字面量中，由闭合的两条斜线组成一个模式，（正则表达式的）标记定义在第二个（斜线）标记之后。他们也可以通过正则表达式 对象的构造函数（第二个参数）来定义。正则表达式的标记可以单独或者任意次序的组合使用，但 ECMAScript 只规定了五个。

要使正则表达式包含标记，使用此语法：

```js
var re = /pattern/flags;
```

或

```js
var re = new RegExp("pattern", "flags");
```

| 标记 | 说明                                                                                   |
| ---- | -------------------------------------------------------------------------------------- |
| `g`  | 整体检索。                                                                             |
| i    | 忽略大小写检索。                                                                       |
| m    | 多行检索。                                                                             |
| u    | Unicode; 将模式视为 Unicode 码点的序列                                                 |
| y    | sticky 检索将从目标字符串的当前位置开始匹配。参阅sticky |

### 示例

只有 5 个有效的正则表达式标记。

```js
/foo/bar;

// SyntaxError: invalid regular expression flag "b"
```

你打算创建一个正则表达式吗？一个包含两条斜线的表达式被解释为一个正则表达式的字面量。

```js
let obj = {
  url: /docs/Web
};

// SyntaxError: invalid regular expression flag "W"
```

还是你想创建一个字符串呢？添加单引号或双引号创建一个字符串字面量。

```js
let obj = {
  url: "/docs/Web",
};
```

#### 有效的正则表达式标记

在 JavaScript 中允许的五个有效的正则表达式标记，参阅上表。

```js
/foo/g;
/foo/gim;
/foo/uy;
```

### 相关页面

- 正则表达式
- [XRegEx flags](https://xregexp.com/flags/) – 正则表达式库提供新的四个标记 (`n`, `s`, `x`, `A`)

## SyntaxError: JSON.parse: bad parsing

### 信息

```plain
SyntaxError: JSON.parse: unterminated string literal
SyntaxError: JSON.parse: bad control character in string literal
SyntaxError: JSON.parse: bad character in string literal
SyntaxError: JSON.parse: bad Unicode escape
SyntaxError: JSON.parse: bad escape character
SyntaxError: JSON.parse: unterminated string
SyntaxError: JSON.parse: no number after minus sign
SyntaxError: JSON.parse: unexpected non-digit
SyntaxError: JSON.parse: missing digits after decimal point
SyntaxError: JSON.parse: unterminated fractional number
SyntaxError: JSON.parse: missing digits after exponent indicator
SyntaxError: JSON.parse: missing digits after exponent sign
SyntaxError: JSON.parse: exponent part is missing a number
SyntaxError: JSON.parse: unexpected end of data
SyntaxError: JSON.parse: unexpected keyword
SyntaxError: JSON.parse: unexpected character
SyntaxError: JSON.parse: end of data while reading object contents
SyntaxError: JSON.parse: expected property name or '}'
SyntaxError: JSON.parse: end of data when ',' or ']' was expected
SyntaxError: JSON.parse: expected ',' or ']' after array element
SyntaxError: JSON.parse: end of data when property name was expected
SyntaxError: JSON.parse: expected double-quoted property name
SyntaxError: JSON.parse: end of data after property name when ':' was expected
SyntaxError: JSON.parse: expected ':' after property name in object
SyntaxError: JSON.parse: end of data after property value in object
SyntaxError: JSON.parse: expected ',' or '}' after property value in object
SyntaxError: JSON.parse: expected ',' or '}' after property-value pair in object literal
SyntaxError: JSON.parse: property names must be double-quoted strings
SyntaxError: JSON.parse: expected property name or '}'
SyntaxError: JSON.parse: unexpected character
SyntaxError: JSON.parse: unexpected non-whitespace character after JSON data
```

### 错误类型

SyntaxError

### 哪里出错了？

JSON.parse() 会把一个字符串解析成 JSON 对象。如果字符串书写正确，那么其将会被解析成一个有效的 JSON，但是这个字符串被检测出错误语法的时候将会抛出错误。

### 示例

#### `JSON.parse()` 不允许在末尾添加多余的逗号

下面两行代码都会抛出错误：

```js
JSON.parse("[1, 2, 3, 4, ]");
JSON.parse('{"foo" : 1, }');
// SyntaxError JSON.parse: unexpected character
// at line 1 column 14 of the JSON data
```

省略末尾多余的逗号解析 JSON 就是正确：

```js
JSON.parse("[1, 2, 3, 4 ]");
JSON.parse('{"foo" : 1 }');
```

#### JSON 的属性名必须使用双引号

属性名上不能使用单引号，例如： 'foo'。

```js
JSON.parse("{'foo' : 1 }");
// SyntaxError: JSON.parse: expected property name or '}'
// at line 1 column 2 of the JSON data
```

取而代之，写成 "foo"：

```js
JSON.parse('{"foo" : 1 }');
```

#### 前导 0 和小数点

数字不能用 0 开头，比如 01，并且你的小数点后面必须跟着至少一个数字。

```js
JSON.parse('{"foo" : 01 }');
// SyntaxError: JSON.parse: expected ',' or '}' after property value
// in object at line 1 column 2 of the JSON data

JSON.parse('{"foo" : 1. }');
// SyntaxError: JSON.parse: unterminated fractional number
// at line 1 column 2 of the JSON data
```

正确的写法应该是只写一个 1，不书写前面的 0。在小数点的后面至少要跟上一个数字：

```js
JSON.parse('{"foo" : 1 }');
JSON.parse('{"foo" : 1.0 }');
```

### 参见

- JSON
- JSON.parse()
- JSON.stringify()

## SyntaxError: missing : after property id

### 错误提示

```plain
SyntaxError: missing : after property id
```

### 错误类型

SyntaxError

### 哪里出错了？

当使用对象初始化语法创建对象的时候，需要使用半角冒号 (:) 将属性键与属性值隔开。

```js
var obj = { propertyKey: "value" };
```

### 示例

#### 冒号与等号

下面的代码会运行失败，原因是对象初始化语法中不允许使用等号来代替冒号。

```js
var obj = { propertyKey = 'value' };
// SyntaxError: missing : after property id
```

修复方法就是使用冒号，或者是在对象创建之后使用方括号语法来为其设定新的属性。

```js
var obj = { propertyKey: "value" };

// or alternatively

var obj = {};
obj["propertyKey"] = "value";
```

#### 空属性

不能像下面这样创建空属性：

```js
var obj = { propertyKey; };
// SyntaxError: missing : after property id
```

假如你需要创建一个无值属性，那么需要将它的值设置为 null 。

```js
var obj = { propertyKey: null };
```

#### 计算得来的属性

如果需要使用表达式来创建属性键，那么需要使用方括号。否则属性名称不会进行计算：

```js
var obj = { 'b'+'ar': 'foo' };
// SyntaxError: missing : after property id
```

把计算表达式放置到方括号（`[]`）中：

```js
var obj = { ["b" + "ar"]: "foo" };
```

### 相关内容

- Object initializer

## SyntaxError: missing ) after argument list

### 消息

```plain
语法错误：参数列表后面缺少 )
```

### 错误类型

SyntaxError.

### 什么地方出错了？

有一个函数在调用时出现错误。这可能是一个错误，丢失运算符或者转义字符等。

### 示例

因为没有使用“+”操作符来连接字符串，JavaScript 认为 `log` 函数的参数的值只是 `"PI: "`，在这种情况下，它应该用一个右括号作为结束。

```js
console.log("PI: " Math.PI);
// SyntaxError: missing ) after argument list
```

你可以正确的调用 `log` 函数通过加上“+”操作符。

```js
console.log("PI: " + Math.PI);
// "PI: 3.141592653589793"
```

### 相关页面

- Functions

## SyntaxError: missing ) after condition

### 错误提示

```plain
SyntaxError: missing ) after condition
```

### 错误类型

SyntaxError

### 哪里出错了？

这个错误与 if 条件语句是如何写的有关。在任何编程语言中，代码都需要做出一些判断，然后根据不同的判断结果来执行不同的操作。if 语句会在其指定的判断条件为真的时候执行。在 JavaScript 中，条件表达式必须出现在 if 关键字后面的一对括号中，像下面这样：

```js
if (condition) {
  // do something if the condition is true
}
```

### 示例

下面这种情况的出现可能只是出于大意，需要仔细检查代码中的括号。

```js
if (3 > Math.PI {
  console.log("wait what?");
}

// SyntaxError: missing ) after condition
```

修复代码的方法就是添加闭合条件表达式的右括号。

```js
if (3 > Math.PI) {
  console.log("wait what?");
}
```

如果你是从其他语言转到 JavaScript 的，那么很容易在 JavaScript 中使用与之含义不同或者没有任何意义的关键字。

```js
if (done is true) {
 console.log("we are done!");
}

// SyntaxError: missing ) after condition
```

相反你需要使用正确的比较操作符，如下：

```js
if (done === true) {
  console.log("we are done!");
}
```

### 相关内容

- `if...else`
- 比较操作符
- 在代码中做判断 — 条件表达式

## SyntaxError: missing ] after element list

### 信息

```plain
SyntaxError: missing ] after element list
```

### 错误类型

SyntaxError.

### 哪里出错了？

数组初始化在某处出现了语法错误。比如缺少了右中括号 ("`]`") 或一个逗号 ("`,`")。

### 示例

#### 不正确的数组初始化

```js
var list = [1, 2,

var instruments = [
  "Ukulele",
  "Guitar",
  "Piano"
};

var data = [{foo: "bar"} {bar: "foo"}];
```

正确的是：

```js
var list = [1, 2];

var instruments = ["Ukulele", "Guitar", "Piano"];

var data = [{ foo: "bar" }, { bar: "foo" }];
```

### 相关

- Array

## SyntaxError: missing } after function body

### 错误提示

```plain
SyntaxError: missing } after function body
```

### 错误类型

SyntaxError

### 哪里出错了？

在创建函数的时候出现了语法错误。检查一下闭合花括号以及括号的顺序是否正确。将代码进行缩进或者美化可以让你更容易找到问题之所在。

### 示例

#### 遗漏的闭合花括号

通常是因为在函数声明中遗漏了花括号：

```js
var charge = function() {
  if (sunny) {
    useSolarCells();
  } else {
    promptBikeRide();
};
```

正确的应该是这样的：

```js
var charge = function () {
  if (sunny) {
    useSolarCells();
  } else {
    promptBikeRide();
  }
};
```

当使用立即调用函数表达式（IIFE）、闭包或者其他使用了大量的花括号以及括号的结构体的时候，问题会更加隐蔽。

```js
(function() { if (true) { return false; } );
```

通常将代码语句按照层级缩进以及对缩进进行复核会有助于错误的发现。

```js
(function () {
  if (true) {
    return false;
  }
});
```

### 相关内容

- Functions

## SyntaxError: missing } after property list

JavaScript 异常 **`missing } after property list`** 会在对象初始化器语法某处出错时发生。实际上可能是少了花括号，也可能是少了逗号。

### 错误信息

```plain
SyntaxError: missing } after property list (Firefox)
SyntaxError: Unexpected identifier 'c'. Expected '}' to end an object literal. (Safari)
```

### 错误类型

SyntaxError

### 什么地方出错了？

对象初始化器语法某处出错了。实际上可能是少了花括号，但也可能是少了逗号。另外请检查右花括号或圆括号的顺序是否正确。把代码缩进或格式化得更整齐一些，也有助于看清结构。

### 示例

#### 遗漏逗号

对象初始化器代码里常常少了一个逗号：

```js
const obj = {
  a: 1,
  b: { myProp: 2 }
  c: 3
};
```

正确写法是：

```js
const obj = {
  a: 1,
  b: { myProp: 2 },
  c: 3,
};
```

### 参见

- 对象初始化器

## SyntaxError: missing = in const declaration

### 错误提示

```plain
SyntaxError: missing = in const declaration (Firefox)
SyntaxError: Missing initializer in const declaration (Chrome)
```

### 错误类型

SyntaxError

### 哪里出错了？

常量指的是在程序正常运行过程中不能被修改的值。它的值不能通过二次赋值来改变，同时也不能被再次声明。在 JavaScript 中，常量在声明时使用 `const` 关键字来修饰。常量需要初始化器；也就是说，必须在声明的同时为其赋值（鉴于常量值指定之后不能再进行修改，这样做是容易理解的）。

### 示例

#### 初始值缺失

不同于 var 或 let 关键字，必须在常量声明中为其赋值。下面的例子中会报错：

```js
const COLUMNS;
// SyntaxError: missing = in const declaration
```

#### 错误修正

修正这个问题的方法有很多种。仔细检查对于问题中的常量，你想要达到什么目标。

##### 添加常量值

在声明语句中为其赋值：

```js
const COLUMNS = 80;
```

##### `const`, `let` 还是 `var?`

如果你并不想声明一个常量值，那么就不要使用 const 关键字。或许你想要的是使用 `let` 来声明一个块状作用域变量或者是用 `var` 声明一个全局变量。这两者都不需要设置初始值。

```js
let columns;
```

### 相关内容

- `let`
- `var`

## SyntaxError: missing formal parameter

### 信息提示

```plain
SyntaxError: missing formal parameter (Firefox)
```

### 错误类型

SyntaxError

### 哪里出错了？

“形式参数”是“函数参数”一种更好的说法。函数声明缺少合法的参数定义。在函数声明中，参数定义必须为标记符（identifiers），而不是任何类似于数字、字符串或者对象的值。函数声明和函数调用是两个不同的步骤。函数声明中的参数需要使用标记符，而仅仅在函数被呼叫（调用）的时候才可以传入其所需要的值。

在 JavaScript 中，标记符只能由字母、数字、"$" 以及 "\_" 构成，并且不能以数字开头。标记符与**字符串**的区别在于字符串是数据，而标记符属于代码的一部分。

### 示例

在构造一个函数的时候，函数参数必须为标记符。下面列举的函数声明都是无效的，因为它们在参数部分使用的是数值：

```js
function square(3) {
  return number * number;
};
// SyntaxError: missing formal parameter

function greet("Howdy") {
  return greeting;
};
// SyntaxError: missing formal parameter

function log({ obj: "value"}) {
  console.log(arg)
};
// SyntaxError: missing formal parameter
```

需要在函数声明中使用标记符：

```js
function square(number) {
  return number * number;
}

function greet(greeting) {
  return greeting;
}

function log(arg) {
  console.log(arg);
}
```

之后可以传入你想要传入的实际参数调用函数：

```js
square(2); // 4

greet("Howdy"); // "Howdy"

log({ obj: "value" }); // Object { obj: "value" }
```

### 参见

- SyntaxError: redeclaration of formal parameter "x"

## SyntaxError: missing name after . operator

### 错误提示

```plain
SyntaxError: missing name after . operator
```

### 错误类型

SyntaxError

### 哪里出错了？

点操作符 (`.`) 用于属性访问。你需要指定要访问的属性名称。对于属性名称是运算表达式的属性访问，需要将属性访问的方式从点操作符转换为方括号操作符。这样你就可以在其中进行表达式运算了。或许你想要进行字符串拼接操作？那么请使用加号操作符（+）。请参考下面的示例。

### 示例

#### 属性访问

在 JavaScript 中，属性访问器或者使用点操作符 (.)，或者使用方括号操作符 (\[])，但是二者不能同时使用。方括号操作符允许属性名称为运算表达式的属性访问。

```js
var obj = { foo: { bar: "baz", bar2: "baz2" } };
var i = 2;

obj.[foo].[bar]
// SyntaxError: missing name after . operator

obj.foo."bar"+i;
// SyntaxError: missing name after . operator
```

为了进行代码修复，你需要向下面这样来访问对象：

```js
obj.foo.bar; // "baz"
// or alternatively
obj["foo"]["bar"]; // "baz"

// computed properties require square brackets
obj.foo["bar" + i]; // "baz2"
```

#### 属性访问与字符串拼接

如果你是中其他编程语言（如 PHP）转到 JavaScript 的，很容易将点操作符 (.) 与连接操作符 (+) 混用：

```js
console.log("Hello" . "world");

// SyntaxError: missing name after . operator
```

相反要使用加号来进行字符串拼接：

```js
console.log("Hello" + "World");
```

### 相关页面

- 属性访问器

## SyntaxError: missing variable name

### 错误提示

```plain
SyntaxError: missing variable name (Firefox)
SyntaxError: Unexpected token '='. Expected a parameter pattern or a ')' in parameter list. (Safari)
```

### 错误类型

SyntaxError

### 哪里出错了？

缺失变量名。这有很大的可能性是由你的代码中的语法错误造成的。也许是什么地方的逗号出了问题，或者是你正在绞尽脑汁想一个合适的名字。完全可以理解！为变量起名确实让人头疼。

### 示例

#### 变量名缺失

```js
const = "foo";
```

很容易忘记给变量命名！

```js
const description = "foo";
```

#### 保留字不能作为变量名

有一些名称是作为保留字而存在的。不好意思，你不能使用！:(

```js
const debugger = "whoop";
// SyntaxError: missing variable name
```

#### 一次性声明多个变量

在一次性声明多个变量的时候要特别留意逗号。看看是否有多余的逗号？以及是否不小心把逗号用作了分号？

```js
let x, y = "foo",
const z, = "foo"

const first = document.getElementById("one"),
const second = document.getElementById("two"),

// SyntaxError: missing variable name
```

修复后的代码：

```js
let x,
  y = "foo";
const z = "foo";

const first = document.getElementById("one");
const second = document.getElementById("two");
```

#### 数组

在 JavaScript 中 Array 字面量需要使用方括号将值包裹起来。下面这样是不对的：

```js
const arr = 1,2,3,4,5;
// SyntaxError: missing variable name
```

这样写才是正确的：

```js
const arr = [1, 2, 3, 4, 5];
```

### 参见

- 词法语法
- var
- 语法与类型指南

## SyntaxError: redeclaration of formal parameter "x"

### 信息

```plain
SyntaxError: redeclaration of formal parameter "x" (Firefox)
SyntaxError: Identifier "x" has already been declared (Chrome)
SyntaxError: Cannot declare a let variable twice: 'x' (WebKit)
```

### 错误类型

SyntaxError

### 哪里出错了？

某个变量名称已经作为函数参数出现了，但是又使用了 `let` 在函数体里重声明了。在 JavaScript 中不允许使用 let 在相同的函数或块范围内重新声明相同的变量。

### 示例

在本例中，参数 "arg" 又重新声明了：

```js
function f(arg) {
  let arg = "foo";
}

// SyntaxError: redeclaration of formal parameter "arg"
```

如果要更改函数体中的“arg”的值，可以像下面一样，但不需要再次声明同一个变量。换句话说：你可以省略 let 关键字。如果要创建一个新变量，则需要将其重命名，因为其与函数参数有冲突。

```js
function f(arg) {
  arg = "foo";
}

function f(arg) {
  let bar = "foo";
}
```

### 兼容性提醒

- 在 Firefox 49 之前，会抛出的是 TypeError（[Firefox bug 1275240](https://bugzil.la/1275240)）。

### 相关

- `let`
- `const`
- `var`
- Declaring variables in the JavaScript Guide

## SyntaxError: return not in function

当 `return` 语句在函数外部被调用时，JavaScript 会抛出“return not in function”异常。

### 错误信息

```plain
SyntaxError: Illegal return statement (V8-based)
SyntaxError: return not in function (Firefox)
SyntaxError: Return statements are only valid inside functions. (Safari)
```

### 错误类型

SyntaxError。

### 什么地方出错了？

`return` 语句在函数外部被调用了。可能是某处缺失了花括号？`return` 语句必须位于函数内部，因为它会终止函数执行并指定一个值返回给函数调用者。

### 示例

#### 缺少大括号

```js
function cheer(score) {
  if (score === 147)
    return "最大！";
  }
  if (score > 100) {
    return "世纪！";
  }
}

// SyntaxError: return not in function
```

花括号乍一看之下似乎是正确的，但这段代码在第一个 `if` 语句后缺少了一个 `{`。正确的写法应该是：

```js
function cheer(score) {
  if (score === 147) {
    return "最大！";
  }
  if (score > 100) {
    return "世纪！";
  }
}
```

### 参见

- `return`

## SyntaxError: string literal contains an unescaped line break

### 信息

```plain
SyntaxError: Invalid or unexpected token (V8-based)
SyntaxError: '' string literal contains an unescaped line break (Firefox)
SyntaxError: Unexpected EOF (Safari)
```

### 错误类型

SyntaxError

### 哪里出错了？

某处 js 解析字符串出错。字符串必须使用单引号或双引号来正确的关闭。在 Javascript 中使用单引号的字符和双引号的字符串是没有区别的。字符串用转义字符不是单引号就是双引。为解决这个错误，检查一下：

- 你字符串的引号是否成对。
- 你是否正确使用了转义序列
- 你的字符串是否在多行中解析正常。

### 示例

#### 多行字符串

在 javascript 中你不能够直接使用多行字符串赋值给一个变量。如下：

```js
var longString = "This is a very long string which needs
                  to wrap across multiple lines because
                  otherwise my code is unreadable.";
// SyntaxError: unterminated string literal
```

可以使用"+"运算符，反斜杠，或模板字符串来代替多行。“+”运算符的使用如下：

```js
var longString =
  "This is a very long string which needs " +
  "to wrap across multiple lines because " +
  "otherwise my code is unreadable.";
```

或者你可以使用“\”在每一行的末尾，以表示该字符串在下一行继续。要确保“\“之后没有没有空格和任何其他的字符，及缩进，否则该“\”将不会起作用。使用方法如下：

```js
var longString =
  "This is a very long string which needs \
to wrap across multiple lines because \
otherwise my code is unreadable.";
```

另一种方式是使用 ES 2015 的环境所支持模板字符串（反引号\` \`）。

```js
var longString = `This is a very long string which needs
                  to wrap across multiple lines because
                  otherwise my code is unreadable.`;
```

### 相关

- String
- 模板字符串

## SyntaxError: Unexpected token

JavaScript 异常“unexpected token”会在解析器在给定位置没有识别到它可以理解的标记（而无法理解程序的结构）时发生。这可能只是一个简单的拼写错误。

### 信息

```plain
SyntaxError: Unexpected token ';' (V8-based)
SyntaxError: Unexpected identifier 'x' (V8-based)
SyntaxError: Unexpected number (V8-based)
SyntaxError: Unexpected string (V8-based)
SyntaxError: Unexpected regular expression (V8-based)
SyntaxError: Unexpected template string (V8-based)
SyntaxError: unexpected token: identifier (Firefox)
SyntaxError: expected expression, got "x" (Firefox)
SyntaxError: expected property name, got "x" (Firefox)
SyntaxError: expected target, got "x" (Firefox)
SyntaxError: expected meta, got "x" (Firefox)
SyntaxError: expected rest argument name, got "x" (Firefox)
SyntaxError: expected closing parenthesis, got "x" (Firefox)
```

### 错误类型

SyntaxError

### 哪里出错了？

期望获得一个特定的语法结构，但得到了其他的。可能只是一个简单的错字。

### 示例

#### 期望的表达式

例如，在调用函数时，不允许使用尾随逗号。有尾逗号的时候，JavaScript 会期望有另一个参数，可以是任何表达式。

```js
Math.max(2, 42,);
// SyntaxError: expected expression, got ')'
```

正确的方法是省略最后一个逗号或添加另一个参数：

```js
Math.max(2, 42);
Math.max(2, 42, 13 + 37);
```

### 参见

- SyntaxError

## SyntaxError: Using //@ to indicate sourceURL pragmas is deprecated. Use //# instead

### 信息

```plain
Warning: SyntaxError: Using //@ to indicate sourceURL pragmas is deprecated. Use //# instead

Warning: SyntaxError: Using //@ to indicate sourceMappingURL pragmas is deprecated. Use //# instead
```

### 错误类型

SyntaxError 的警告。不会终止 JavaScript 的执行。

### 哪里错了？

在 JavaScript 源码中使用了已废弃的 source map 语法。

JavaScript 源代码经常被组合和压缩，以便能更高效地从服务器获取它们。使用了 [source maps](https://www.html5rocks.com/en/tutorials/developertools/sourcemaps/)，调试器就可以将正在执行的代码映射到原始源文件。

因为在 IE 浏览器中，只要页面存在 `//@cc_on` 注释，都会被 IE JScript 引擎解释为要打开条件编译，所以 source map 的规范更改了语法。[条件编译注释](https://msdn.microsoft.com/en-us/library/8ka90k2e%28v=vs.94%29.aspx) 是 IE 的一个鲜为人知的特性，但是它破坏了 [jQuery](https://bugs.jquery.com/ticket/13274) 和其他库的 source map。

### 示例

#### 废弃的语法

使用 "@" 符号的语法已经被废弃了。

```js
//@ sourceMappingURL=http://example.com/path/to/your/sourcemap.map
```

#### 标准语法

使用 "#" 符号代替。

```js
//# sourceMappingURL=http://example.com/path/to/your/sourcemap.map
```

或者，你也可以为 JavaScript 文件设置 header，以避免添加注释：

```js
X-SourceMap: /path/to/file.js.map
```

### 参见

- [How to use a source map – Firefox Tools documentation](https://firefox-source-docs.mozilla.org/devtools-user/debugger/how_to/use_a_source_map/index.html)
- [Introduction to source maps – HTML5 rocks](https://www.html5rocks.com/en/tutorials/developertools/sourcemaps/)

## TypeError: 'x' is not iterable

### 错误信息

```plain
TypeError: 'x' is not iterable (Firefox, Chrome)
TypeError: 'x' is not a function or its return value is not iterable (Chrome)
```

### 错误类型

TypeError

### 发生了什么错误？

这个值作为 for…of 的表达式右值，或者作为一个函数的参数，如 Promise.all 或者 TypedArray.from, 不是一个 可迭代对象. 一个可迭代对象可以是一个内置可迭代类型，如Array, String 或 Map, 一个 generator 生成结果，或者一个实现了 可迭代协议 的对象

### 示例

#### Iterating over Object properties

在 JavaScript 中，Object 是不可迭代的，除非它们实现了迭代协议. 因此，你不能使用 for…of 来迭代对象的属性。

```js
var obj = { France: "Paris", England: "London" };
for (let p of obj) {
  // TypeError: obj is not iterable
  // …
}
```

作为替代，你必须使用 Object.keys 或 Object.entries 来迭代对象的属性或属性值。

```js
var obj = { France: "Paris", England: "London" };
// 迭代属性名称：
for (let country of Object.keys(obj)) {
  var capital = obj[country];
  console.log(country, capital);
}

for (const [country, capital] of Object.entries(obj))
  console.log(country, capital);
```

这次 case 的另外一个选择是使用 Map:

```js
var map = new Map();
map.set("France", "Paris");
map.set("England", "London");
// Iterate over the property names:
for (let country of map.keys()) {
  let capital = map[country];
  console.log(country, capital);
}

for (let capital of map.values()) console.log(capital);

for (const [country, capital] of map.entries()) console.log(country, capital);
```

#### Iterating over a generator

生成器是用来生成可迭代对象的函数。

```js
function* generate(a, b) {
  yield a;
  yield b;
}

for (let x of generate)
  // TypeError: generate is not iterable
  console.log(x);
```

当它没有被调用，这个 Function 相应的是可调用的，但是不可迭代。调用 generator 生成一个可迭代对象，该对象将迭代在生成器执行期间生成的值。

```js
function* generate(a, b) {
  yield a;
  yield b;
}

for (let x of generate(1, 2)) console.log(x);
```

#### Iterating over a custom iterable

可以使用Symbol.iterator 方法去实现一个自定义迭代器。你必须确定自定义的迭代器方法返回一个迭代器对象，即它必须有一个 next()

```js
const myEmptyIterable = {
  [Symbol.iterator]() {
    return []; // [] is iterable, but it is not an iterator -- it has no next method.
  },
};

Array.from(myEmptyIterable); // TypeError: myEmptyIterable is not iterable
```

```plain

```

下面是正确用法

```js
const myEmptyIterable = {
  [Symbol.iterator]() {
    return [][Symbol.iterator]();
  },
};

Array.from(myEmptyIterable); // []
```

### 参阅

- iterable protocol
- Object.keys
- Object.entries
- Map
- 生成器
- for…of

## TypeError: "x" has no properties

### 错误信息

```plain
TypeError: null has no properties
TypeError: undefined has no properties
```

### 错误类型

TypeError.

### 哪里出错了？

null 和 undefined中，没有你需要的属性。

### 示例

```js
null.foo;
// 错误类型：null 没有这个属性

undefined.bar;
// 错误类型：undefined 没有这个属性
```

### 参考

- null
- undefined

## TypeError: "x" is (not) "y"

JavaScript 异常“_x_ is (not) _y_”在出现与期望不符的类型（通常为意外获得的 undefined 或 null 值）时被抛出。

### 消息

```plain
TypeError: Cannot read properties of undefined (reading 'x') (V8-based)
TypeError: "x" is undefined (Firefox)
TypeError: "undefined" is not an object (Firefox)
TypeError: undefined is not an object (evaluating 'obj.x') (Safari)

TypeError: "x" is not a symbol (V8-based & Firefox)
TypeError: Symbol.keyFor requires that the first argument be a symbol (Safari)
```

### 错误类型

TypeError。

### 什么地方出错了？

出现了与期望不符的类型。这个错误常常由 undefined 或 null 值引起。

此外，某些方法，例如 Object.create() 或 Symbol.keyFor()，要求必须提供特定类型的参数。

### 示例

#### 错误情形

```js
// undefined and null cases on which the substring method won't work
const foo = undefined;
foo.substring(1); // TypeError: foo is undefined

const foo = null;
foo.substring(1); // TypeError: foo is null

// Certain methods might require a specific type
const foo = {};
Symbol.keyFor(foo); // TypeError: foo is not a symbol

const foo = "bar";
Object.create(foo); // TypeError: "foo" is not an object or null
```

#### 解决方法

要解决值为 `undefined` 或 `null` 的空指针问题，你可以首先测试值是否为 `undefined` 或 `null`。

```js
if (foo !== undefined && foo !== null) {
  // Now we know that foo is defined, we are good to go.
}
```

或者，你如果能确定 `foo` 的值不会是其他的假值（如：`""` 或 `0`），或者排除这些情况不是问题，那你可以简单地测试其是否为真。

```js
if (foo) {
  // Now we know that foo is truthy, it will necessarily not be null/undefined.
}
```

### 参见

- undefined
- null

## TypeError: "x" is not a constructor

### 信息

```plain
TypeError: "x" is not a constructor

TypeError: Math is not a constructor
TypeError: JSON is not a constructor
TypeError: Symbol is not a constructor
TypeError: Reflect is not a constructor
TypeError: Intl is not a constructor
TypeError: SIMD is not a constructor
TypeError: Atomics is not a constructor
```

### 错误类型

TypeError

### 哪里出错了？

是因为尝试将不是构造器的对象或者变量来作为构造器使用。参考 constructor 或者 `new` operator 来了解什么是构造器。

有很多的全局对象比如 String、Array 等等都是可以使用 `new` 操作符的构造器。但是有一些全局对象并不是，且其属性和方法都是[静态](<https://zh.wikipedia.org/wiki/方法_(電腦科學)#靜態（共享/類別）方法>) 的。下面的 JavaScript 标准内置对象都不是构造函数：Math、JSON、Symbol、Reflect、Intl、`SIMD`、Atomics。

Generator functions 也不能作为构造器来使用。

### 示例

#### 无效的

```js
var Car = 1;
new Car();
// TypeError: Car is not a constructor

new Math();
// TypeError: Math is not a constructor

new Symbol();
// TypeError: Symbol is not a constructor

function* f() {}
var obj = new f();
// TypeError: f is not a constructor
```

#### 一个构造器

假设你想为汽车创建一个对象类型。你希望此类型的对象被称为 `car`，并且你希望它具有 make，model 和 year 属性。为此，你编写以下函数：

```js
function Car(make, model, year) {
  this.make = make;
  this.model = model;
  this.year = year;
}
```

现在你可以创建一个名为 `mycar` 的对象，如下所示：

```js
var mycar = new Car("Eagle", "Talon TSi", 1993);
```

#### 关于 Promises

当返回了一个 immediately-resolved 或者 immediately-rejected Promise 的时候，你根本不需要去创建、操作一个新的 Promise 对象。

这是不合法的（Promise 构造函数被错误地调用了）且会抛出 `TypeError: this is not a constructor` 异常：

```js
return new Promise.resolve(true);
```

使用 Promise.resolve() 或者 Promise.reject() 静态方法来代替：

```js
// 这是合法的，但是没必要这么长：
return new Promise((resolve, reject) => {
  resolve(true);
});

// 用静态方法来代替：
return Promise.resolve(true);
return Promise.reject(false);
```

### 参见

- constructor
- `new` 运算符

## TypeError: "x" is not a function

JavaScript 异常"is not a function"会在试图去调用一个像函数一样的值，但是该值实际上不是函数时被抛出。

### 信息

```plain
TypeError: Object doesn't support property or method {x} (Edge)
TypeError: "x" is not a function
```

### 错误类型

TypeError

### 哪里出错了？

问题出在你试图去调用一个像函数一样的值，但是该值实际上不是函数，有时候你的代码需要调用一些函数，但是那种值并不能当作函数来被调用。

也许函数名称上有错别字？也许你正在调用 Object 对象没有这个方法？例如，在 JavaScript 中单纯的对象 (Object) 没有**map**函数，但是 JavaScript 数组 (Array) 对象却有这个函数。

再比如，在 JavaScript 中很多原生对象的内置方法需要你提供一个（回调）函数。所以你必须提供一个函数，以使这些方法正常工作：

- 当你在使用 Array 或 TypedArray 对象时：
  - Array.prototype.every(), Array.prototype.some(), Array.prototype.forEach(), Array.prototype.map(), Array.prototype.filter(), Array.prototype.reduce(), Array.prototype.reduceRight(), Array.prototype.find()

- 当你在使用 Map 和 Set 对象时：
  - Map.prototype.forEach() and Set.prototype.forEach()

### 示例

#### 函数的名称错误

函数的名称拼写错误，这种情况是经常发生的：

```js
var x = document.getElementByID("foo");
// TypeError: document.getElementByID is not a function
```

正确的方法名应该是 `getElementById：`

```js
var x = document.getElementById("foo");
```

#### 调用 Object 类型中不存在的方法

对于某些特殊的方法，它只属于某些特定的原生对象中，你必须提供一个回调函数才能正常运行。例如：这里调用了一个 Array.prototype.map() 方法，但是这方法只能被 Array 对象所调用。

```js
var obj = { a: 13, b: 37, c: 42 };

obj.map(function (num) {
  return num * 2;
});

// TypeError: obj.map is not a function
```

正确的做法，使用一个数组来代替：

```js
var numbers = [1, 4, 9];

numbers.map(function (num) {
  return num * 2;
});

// Array [ 2, 8, 18 ]
```

#### 函数与已有属性重名

当你在创建类时，可能会存在某个属性和某个方法的名称相同，当你在调用该函数时，编译器会认为该函数不存在。

```js
var Dog = function () {
  this.age = 11;
  this.color = "black";
  this.name = "Ralph";
  return this;
};

Dog.prototype.name = function (name) {
  this.name = name;
  return this;
};

var myNewDog = new Dog();
myNewDog.name("Cassidy"); //Uncaught TypeError: myNewDog.name is not a function
```

正确的做法是使用不同的变量名。

```js
var Dog = function () {
  this.age = 11;
  this.color = "black";
  this.dogName = "Ralph"; //Using this.dogName instead of .name
  return this;
};

Dog.prototype.name = function (name) {
  this.dogName = name;
  return this;
};

var myNewDog = new Dog();
myNewDog.name("Cassidy"); //Dog { age: 11, color: 'black', dogName: 'Cassidy' }
```

#### 使用括号进行乘法运算

在数学中，你可以将 2 × (3 + 5) 写为 2\*(3 + 5) 或者省略为 2(3 + 5).

使用后者时将会抛出错误：

```js
const sixteen = 2(3 + 5);
alert("2 x (3 + 5) is " + String(sixteen));
//Uncaught TypeError: 2 is not a function
```

你可以添加乘法运算符 `*` 来改正代码：

```js
const sixteen = 2 * (3 + 5);
alert("2 x (3 + 5) is " + String(sixteen));
//2 x (3 + 5) is 16
```

#### 正确地导入和导出模块

确保正确导入模块。

以下为一个示例模块 (`helpers.js`)

```plain
let helpers = function () { };

helpers.groupBy = function (objectArray, property) {
  return objectArray.reduce(function (acc, obj) {
    var key = obj[property];
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(obj);
    return acc;
  },
{});
}

export default helpers;
```

在 `App.js`中正确导入该模块：

```plain
import helpers from './helpers'
```

### 相关

- Functions

## TypeError: "x" is not a non-null object

### 提示信息

```plain
TypeError: "x" is not a non-null object (Firefox)
TypeError: Property description must be an object: "x" (Chrome)
TypeError: Invalid value used in weak set (Chrome)
```

### 错误类型

TypeError

### 哪里出错了？

在期待出现对象类型的值的地方而没有提供。null 不是对象类型，因此不起作用。必须在给定的场景下提供一个合适的对象。

### 示例

#### 期望的属性描述器

当使用诸如 Object.create() 或 Object.defineProperty() 及{jsxref("Object.defineProperties()")}} 方法时，可选的属性描述器参数需要提供一个描述器对象。提供非对象类型的值（例如数字）将会报错：

```js
Object.defineProperty({}, "key", 1);
// TypeError: 1 is not a non-null object

Object.defineProperty({}, "key", null);
// TypeError: null is not a non-null object
```

一个合法的描述器对象类似于下面这样：

```js
Object.defineProperty({}, "key", { value: "foo", writable: false });
```

#### `WeakMap` 和 `WeakSet` 对象需要对象类型的键

WeakMap 和 WeakSet 对象只能存储对象类型的键，而不能使用其他类型的。

```js
var ws = new WeakSet();
ws.add("foo");
// TypeError: "foo" is not a non-null object
```

用对象类型的值来替换：

```js
ws.add({ foo: "bar" });
ws.add(window);
```

### 相关内容

- Object.create()
- Object.defineProperty(), Object.defineProperties()
- WeakMap, WeakSet

## TypeError: "x" is read-only

### 报错消息

```plain
TypeError: "x" is read-only (Firefox) //格式错误："x"只读。(x 可以代表任意值)
TypeError: 0 is read-only (Firefox)
TypeError: Cannot assign to read only property 'x' of #<Object> (Chrome)
//格式错误：对象的 x 属性是只读的不能设置（chrome）
TypeError: Cannot assign to read only property '0' of [object Array] (Chrome)
```

### 错误格式

TypeError

### 哪里出错了？

全局变量或对象属性被设置为只读 (专业点讲，就是这条数据属性禁止写入.)

这条错误值发生在strict mode code(俗称严格模式). 正常情况下，是没有报错的。

### 例如

#### 无效例子（也就是下面这么做会导致报这种错）

只读属性不能直接创建，但我们可以通过Object.defineProperty() 或 Object.freeze()设置。

```js
"use strict";
var obj = Object.freeze({name: "Elsa", score: 157});
obj.score = 0;  // TypeError

"use strict";
Object.defineProperty(this, "LUNG_COUNT", {value: 2, writable: false});
LUNG_COUNT = 3;  // TypeError

"use strict";
var frozenArray = Object.freeze([0, 1, 2]);
frozenArray[0]++;  // TypeError

还有几个 JavaScript 内置属性。如果你尝试修改一个常量。

"use strict";
Math.PI = 4;  // TypeError
```

傻了吧，报错了

`全局变量 undefined 也是只读的`, 所以你不能忽视臭名昭著的"undefined is not a function"错误：

```js
"use strict";
undefined = function () {}; // TypeError: "undefined" is read-only
```

#### 下面这样都是有效，不报错的

```js
"use strict";
var obj = Object.freeze({ name: "Score", points: 157 });
obj = { name: obj.name, points: 0 }; // 用一个新对象替换原来的对象 (其实就是更改了对象的指针)

("use strict");
var LUNG_COUNT = 2; //
LUNG_COUNT = 3; //
```

### 参见

- Object.defineProperty()
- Object.freeze()
- ["Which animals have three lungs?" on answers.com](https://www.answers.com/Q/Which_animals_have_three_lungs)
- [Klingons](https://aliens.wikia.com/wiki/Klingon) (another answer to that query)

## TypeError: can't assign to property "x" on "y": not an object

### 信息

```plain
TypeError: can't assign to property "x" on {y}: not an object (Firefox)
TypeError: Cannot create property 'x' on {y} (Chrome)
```

### 错误类型

TypeError.

### 原因

在 Strict_mode下，当试图给一个symbol,string,number或者一个boolean类型的数据创建一个属性时就会报 TypeError, 任何 Primitive 值都不允许有property.

这个问题可能是由一个错误的值被放在了一个错误的地方导致的，或者预期String或Number的对象变体

### 示例

#### 错误的情况

```js
"use strict";

var foo = "my string";
// 下面这行代码在非严格模式下不会执行。
foo.bar = {}; // TypeError: can't assign to property "bar" on "my string": not an object
```

#### 如何正确使用

有两种方式，第一种修复这部分代码阻止primitive被用于这种情况，或者可以通过使用对象构造器创建来修复。

```js
"use strict";

var foo = new String("my string");
foo.bar = {};
```

### 页面相关

- Strict_mode
- primitive

## TypeError: can't define property "x": "obj" is not extensible

### 错误提示

```plain
TypeError: can't define property "x": "obj" is not extensible (Firefox)
TypeError: Cannot define property: "x", object is not extensible. (Chrome)
```

### 错误类型

TypeError

### 哪里出错了？

通常情况下，对象是可以进行扩展的，即可以向其添加新的属性。然而当使用 Object.preventExtensions() 将一个对象标记为不再可以扩展的情况下，就无法对该对象添加在其被标记为不可扩展之前所拥有的属性之外的新属性了。

### 示例

在严格模式下，向已经标记为不可扩展的对象添加新属性会报 TypeError 错误。而在非严格模式下，添加属性“x”会被静默忽略。

```js
"use strict";

var obj = {};
Object.preventExtensions(obj);

obj.x = "foo";
// TypeError: can't define property "x": "obj" is not extensible
```

在严格模式和非严格模式下两种模式下，调用Object.defineProperty() 向标记为不可扩展的对象添加新属性都会报 TypeError 错误。

```js
var obj = {};
Object.preventExtensions(obj);

Object.defineProperty(obj, "x", { value: "foo" });
// TypeError: can't define property "x": "obj" is not extensible
```

为了修复这个错误，你可以彻底移除 Object.preventExtensions() 语句，或者将其移动位置，使得属性在对象被标记为不可扩展之前添加。当然如果不需要试图添加的属性的话，你也可以将其移除。

```js
"use strict";

var obj = {};
obj.x = "foo"; // add property first and only then prevent extensions

Object.preventExtensions(obj);
```

### 相关内容

- Object.preventExtensions()

## TypeError: can't delete non-configurable array element

### 错误提示

```plain
TypeError: can't delete non-configurable array element (Firefox)
TypeError: Cannot delete property '2' of [object Array] (Chrome)
```

### 错误类型

TypeError

### 哪里出错了？

这个错误提示发生于当试图缩短一个数组的长度的时候，其中有元素是不可配置的（non-configurable）。正常情况下，缩短数组的长度，则超出限度的元素会被删除，而这里指的是这种操作失效的情况。

`configurable` 特性控制着属性是否可以从对象中删除，以及它的特性（除了 writable 之外）是否可以发生改变。

通常，使用数组初始化语句创建的对象是可配置的，而通过 Object.defineProperty() 创建的属性，默认则是不可配置的。

### 示例

#### `通过 Object.defineProperty 创建的不可配置属性`

使用 Object.defineProperty() 且在没有明确将属性设定为可配置的情况下，默认可以创建不可配置属性。

```js
var arr = [];
Object.defineProperty(arr, 0, { value: 0 });
Object.defineProperty(arr, 1, { value: "1" });

arr.length = 1;
// TypeError: can't delete non-configurable array element
```

如果想要缩短数组长度的话，需要将其中的元素设置为可配置的。

```js
var arr = [];
Object.defineProperty(arr, 0, { value: 0, configurable: true });
Object.defineProperty(arr, 1, { value: "1", configurable: true });

arr.length = 1;
```

#### `密封的数组`

Object.seal() 函数会将数组中现存的所有元素标记为不可配置。

```js
var arr = [1, 2, 3];
Object.seal(arr);

arr.length = 1;
// TypeError: can't delete non-configurable array element
```

（为了解决上述问题，）或者是移除 Object.seal() 调用，或者将数组拷贝一份。在拷贝数组的情况下，缩短备份数组的长度并不会修改原始数组的长度。

```js
var arr = [1, 2, 3];
Object.seal(arr);

// Copy the initial array to shorten the copy
var copy = Array.from(arr);
copy.length = 1;
// arr.length == 3
```

### 参见

- [\[\[Configurable\]\]](/zh-CN/docs/Web/JavaScript/Guide/Data_structures#属性)
- Array.length
- Object.defineProperty()
- Object.seal()

## TypeError: can't redefine non-configurable property "x"

### 错误提示

```plain
TypeError: can't redefine non-configurable property "x" (Firefox)
TypeError: Cannot redefine property: "x" (Chrome)
```

### 错误类型

TypeError

### 哪里出错了？

这种错误的起因在于试图给对象重新定义一个属性，但是该属性是不可配置的。 `configurable` 特性控制着该属性是否可以从对象中删除，以及它的各个特性（除 writable 之外）是否可以修改。通常使用对象初始化语句定义的对象属性是可配置的。而使用 Object.defineProperty() 定义的属性则默认不可配置。

### 示例

#### 使用 object.defineProperty 创建的不可配置属性

在使用 Object.defineProperty() 创建属性的时候，如果没有明确将其设定为可配置的，那么创建出来的属性就是不可配置的。

```js
var obj = Object.create({});
Object.defineProperty(obj, "foo", { value: "bar" });

Object.defineProperty(obj, "foo", { value: "baz" });
// TypeError: can't redefine non-configurable property "foo"
```

如果想要稍后重新定义的话，那么需要将 "foo" 属性设置为可配置的。

```js
var obj = Object.create({});
Object.defineProperty(obj, "foo", { value: "bar", configurable: true });
Object.defineProperty(obj, "foo", { value: "baz", configurable: true });
```

### 参见

- [\[\[Configurable\]\]](/zh-CN/docs/Web/JavaScript/Guide/Data_structures#属性)
- Object.defineProperty()

## TypeError: cyclic object value

在[JSON](https://www.json.org/)中出现循环引用时，JavaScript 会抛出 "cyclic object value" 的异常。JSON.stringify()并不会尝试解决这个问题，因此导致运行失败。

### 提示信息

```js
TypeError: cyclic object value (Firefox)
TypeError: Converting circular structure to JSON (Chrome and Opera)
TypeError: Circular reference in value argument not supported (Edge)
```

### 错误类型

TypeError

### 哪里出错了？

[JSON 格式](https://www.json.org/)本身不支持循环引用对象（尽管存在[IETF 草案](https://datatracker.ietf.org/doc/html/draft-pbryan-zyp-json-ref-03))，因此 JSON.stringify() 并不会尝试解决这个问题而是直接运行失败。

### 示例

#### 循环引用

在如下循环结构中：

```js
var circularReference = { otherData: 123 };
circularReference.myself = circularReference;
```

JSON.stringify() 将会报错

```js
JSON.stringify(circularReference);
// TypeError: cyclic object value
```

要处理循环引用的 JSON，可以使用支持这种结构的库 (例如[cycle.js](https://github.com/douglascrockford/JSON-js/blob/master/cycle.js)))，或者自己实现，需要通过可序列化值查找、替换或者移除循环引用。

下面的代码片段演示了如何使用JSON.stringify()的 `replacer` 参数查找和过滤（会导致数据丢失）循环引用。

```js
const getCircularReplacer = () => {
  const seen = new WeakSet();
  return (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  };
};

JSON.stringify(circularReference, getCircularReplacer());
// {"otherData":123}
```

### 参见

- JSON.stringify
- [cycle.js](https://github.com/douglascrockford/JSON-js/blob/master/cycle.js)
  – 介绍两个方法，`JSON.decycle` 和
  `JSON.retrocycle`，这两个方法能够对循环对象引用结构进行编码和解码，并且使之成为一种扩展的且向下兼容的 JSON 格式。

## TypeError: invalid 'in' operand "x"

### 错误提示

```plain
TypeError: invalid 'in' operand "x" (Firefox)
TypeError: Cannot use 'in' operator to search for 'x' in y (Chrome)
```

### 错误类型

TypeError

### 哪里出错了？

`in` 操作符只可以用来检测对象中是否存在某个属性，而不能用来在字符串、数字或者其他基本类型的数据中进行检索。

### 示例

#### 在字符串中进行检索

与其他语言不同（如 Python），不能使用 `in` 操作符在字符串中进行检索。

```js
"Hello" in "Hello World";
// TypeError: invalid 'in' operand "Hello World"
```

可以使用 String.prototype.indexOf() 来代替：

```js
"Hello World".indexOf("Hello") !== -1;
// true
```

#### 操作数不能为 null 或者 undefined

确保你将要进行探测的对象不为 null 或者 undefined.

```js
var foo = null;
"bar" in foo;
// TypeError: invalid 'in' operand "foo"
```

in 操作符的预期操作数只有对象类型。

```js
var foo = { baz: "bar" };
"bar" in foo; // false

"PI" in Math; // true
"pi" in Math; // false
```

#### 在数组中进行检索

当使用 in 操作符来对 Array 对象进行检索的时候一定要特别小心，因为它检测的是索引值而不是位于索引位置的值。

```js
var trees = ["redwood", "bay", "cedar", "oak", "maple"];
3 in trees; // true
"oak" in trees; // false
```

### 相关内容

- `in` operator

## TypeError: invalid 'instanceof' operand 'x'

### 消息

```plain
TypeError: invalid 'instanceof' operand "x" (Firefox)
TypeError: "x" is not a function (Firefox)
TypeError: Right-hand side of 'instanceof' is not an object (Chrome)
TypeError: Right-hand side of 'instanceof' is not callable (Chrome)
```

### 错误类型

TypeError

### 哪里出错了？

`instanceof` 操作符 希望右边的操作数为一个构造对象，即一个有 `prototype` 属性且可以调用的对象。

### 示例

```js
"test" instanceof ""; // TypeError: invalid 'instanceof' operand ""
42 instanceof 0; // TypeError: invalid 'instanceof' operand 0

function Foo() {}
var f = Foo(); // Foo() is called and returns undefined
var x = new Foo();

x instanceof f; // TypeError: invalid 'instanceof' operand f
x instanceof x; // TypeError: x is not a function
```

为了解决上述问题，你可能需要将`instanceof` 操作符 换成 `typeof` 操作符，或者确保你使用的是函数名称，而不是函数计算的结果。

```js
typeof "test" == "string"; // true
typeof 42 == "number"; // true

function Foo() {}
var f = Foo; // Do not call Foo.
var x = new Foo();

x instanceof f; // true
x instanceof Foo; // true
```

### 参见

- `instanceof` 操作符
- `typeof` 操作符

## TypeError: invalid Array.prototype.sort argument

JavaScript 异常“invalid Array.prototype.sort argument”会在 Array.prototype.sort() 方法（以及其相关方法：Array.prototype.toSorted()、TypedArray.prototype.sort()、TypedArray.prototype.toSorted()）的参数既不是 undefined 也不是用于比较其操作数的函数时触发。

### 消息

```plain
TypeError: The comparison function must be either a function or undefined（基于 V8）

TypeError: invalid Array.prototype.sort argument (Firefox)
TypeError: non-function passed to Array.prototype.toSorted (Firefox)
TypeError: invalid %TypedArray%.prototype.sort argument (Firefox)

TypeError: Array.prototype.sort requires the comparator argument to be a function or undefined (Safari)
TypeError: Array.prototype.toSorted requires the comparator argument to be a function or undefined (Safari)
TypeError: TypedArray.prototype.sort requires the comparator argument to be a function or undefined (Safari)
TypeError: TypedArray.prototype.toSorted requires the comparator argument to be a function or undefined (Safari)
```

### 错误类型

TypeError

### 什么地方出错了？

Array.prototype.sort() 方法（以及其相关方法：Array.prototype.toSorted()、TypedArray.prototype.sort()、TypedArray.prototype.toSorted()）的参数应为 undefined 或用于比较其操作数的函数。

### 示例

#### 无效示例

```js
[1, 3, 2].sort(5); // TypeError
students.toSorted("name"); // TypeError
```

#### 有效示例

```js
[1, 3, 2].sort(); // [1, 2, 3]
[1, 3, 2].sort((a, b) => a - b); // [1, 2, 3]
students.toSorted((a, b) => a.name.localeCompare(b.name));
```

### 参见

- Array.prototype.sort()
- Array.prototype.toSorted()
- TypedArray.prototype.sort()
- TypedArray.prototype.toSorted()

## TypeError: invalid assignment to const "x"

### 错误提示

```plain
TypeError: invalid assignment to const "x" (Firefox)
TypeError: Assignment to constant variable. (Chrome)
TypeError: Redeclaration of const 'x' (IE/Edge)
```

### 错误类型

TypeError

### 哪里出错了？

常量指的是无法在程序正常运行过程中进行修改的值。一方面无法通过重新赋值进行修改，另外一方面也无法进行重新声明。在 JavaScript 中，常量通过关键字 `const` 来声明。

### 示例

#### 不合法的二次声明

在同一作用域内为相同的常量名进行赋值会报错。

```js
const COLUMNS = 80;

// ...

COLUMNS = 120; // TypeError: invalid assignment to const `COLUMNS'
```

#### 问题修复

修复的方式有很多种。可以根据你想要达到的目的来有针对性地对其进行处理。

##### 重新命名

如果想要声明另一个变量，那么请选择其他名称对其重新命名。原来的常量名在该作用域中已经被占有。

```js
const COLUMNS = 80;
const WIDE_COLUMNS = 120;
```

##### `const`, `let` or `var`?

如果你的目的不是为了创建一个常量的话，那么就不要使用 const 关键字。可以使用 `let` 关键字来声明一个拥有块作用域的变量，或者使用 `var` 来声明一个全局变量。

```js
let columns = 80;

// ...

let columns = 120;
```

##### 作用域

检查一下作用域是否正确。例如这个常量是否应该出现在当前作用域，还是应该出现在函数内部？

```js
const COLUMNS = 80;

function setupBigScreenEnvironment() {
  const COLUMNS = 120;
}
```

#### `const 与不可变性`

const 声明语句创建了一个对值的只读引用。这并**不**意味着它指向的值是不可变的，而是说这个变量标记符不能被再次分配。例如，在值是对象的情况下，引用的对象自身内容依然是可以改变的。不能改变该变量的引用：

```js
const obj = { foo: "bar" };
obj = { foo: "baz" }; // TypeError: invalid assignment to const `obj'
```

但是可以改变它引用的值的属性：

```js
obj.foo = "baz";
obj; // Object { foo: "baz" }
```

### 相关内容

- `const`
- `let`
- `var`

## TypeError: More arguments needed

### 信息

```plain
TypeError: Object.create requires more than 0 arguments
TypeError: Object.setPrototypeOf requires more than 1 argument
TypeError: Object.defineProperties requires more than 0 arguments
```

### 错误类型

TypeError.

### 哪里出错了？

调用函数的时候出现了错误。需要提供更多的参数。

### 示例

Object.create() 方法要求至少有一个参数，而 Object.setPrototypeOf() 方法要求至少有两个参数：

```js
var obj = Object.create();
// TypeError: Object.create requires more than 0 arguments

var obj = Object.setPrototypeOf({});
// TypeError: Object.setPrototypeOf requires more than 1 argument
```

你可以将 null 设置为原型：

```js
var obj = Object.create(null);

var obj = Object.setPrototypeOf({}, null);
```

### 相关

- Functions

## TypeError: property "x" is non-configurable and can't be deleted

### 消息

```plain
TypeError: property "x" is non-configurable and can't be deleted. (Firefox)
TypeError: Cannot delete property 'x' of #<Object> (Chrome)
```

### 错误类型

TypeError 只出现在严格模式下。

### 哪里有问题？

尝试删除某个属性，但是这个属性是不可配置的。`configurable` 属性控制是否该属性能从对象上删除，以及它的属性（除了`writable`）能否被修改。

这个错误仅仅在严格模式下出现。在非严格模式下，这个操作返回 `false`。

### 示例

不可配置的属性并不特别常见，但是它们可以使用 Object.defineProperty() 或 Object.freeze() 创建。

```js
"use strict";
var obj = Object.freeze({ name: "Elsa", score: 157 });
delete obj.score; // TypeError

("use strict");
var obj = {};
Object.defineProperty(obj, "foo", { value: 2, configurable: false });
delete obj.foo; // TypeError

("use strict");
var frozenArray = Object.freeze([0, 1, 2]);
frozenArray.pop(); // TypeError
```

也有一些内建于 JavaScript 的不可配置属性。你可能会尝试删除一个数学常量。

```js
"use strict";
delete Math.PI; // TypeError
```

### 参见

- delete operator
- Object.defineProperty()
- Object.freeze()

## TypeError: Reduce of empty array with no initial value

### 消息

```plain
TypeError: reduce of empty array with no initial value
```

### 错误类型

TypeError

### 哪里出问题了？

在 JavaScript 中，有一些 reduce 函数：

- Array.prototype.reduce()，Array.prototype.reduceRight() 和
- TypedArray.prototype.reduce()， TypedArray.prototype.reduceRight())。

这些函数有选择性的接收 `initialValue` (将会被用作回调函数第一次被调用的参数)。然而，如果没有初始值提供，它会用 Array 或 TypedArray 的第一个元素作为初始值。当提供一个空数组的时候这个错误会出现，因为那种情况下没有初始值被返回。

### 示例

#### 无效的情况

当和过滤器（Array.prototype.filter()、TypedArray.prototype.filter()）结合使用的时候，可能会出现列表中所有元素被移除的情况。因此导致初始值为空。

```js
var ints = [0, -1, -2, -3, -4, -5];
ints
  .filter((x) => x > 0) // removes all elements
  .reduce((x, y) => x + y); // no more elements to use for the initial value.
```

类似的，当选择器中有瑕疵的时候相同的问题会发生，或者是列表中未预期的数量的元素：

```js
var names = document.getElementsByClassName("names");
var name_list = Array.prototype.reduce.call(
  names,
  (acc, name) => acc + ", " + name,
);
```

#### 有效的情况

这个问题有两种可能的解决办法：

一种是提供一个初始值作为操作符的中立元素，比如加法里的 0，乘法里的 1，或者是合并中的一个空字符串。

```js
var ints = [0, -1, -2, -3, -4, -5];
ints
  .filter((x) => x < 0) // removes all elements
  .reduce((x, y) => x + y, 0); // the initial value is the neutral element of the addition
```

另一种办法是两方处理空的情况，要么在调用 `reduce` 之前，或者是在添加一个未预料的初始虚拟址后的回调函数中：

```js
var names = document.getElementsByClassName("names");

var name_list1 = "";
if (names1.length >= 1)
  name_list1 = Array.prototype.reduce.call(
    names,
    (acc, name) => acc + ", " + name,
  );
// name_list1 == "" when names is empty.

var name_list2 = Array.prototype.reduce.call(
  names,
  (acc, name) => {
    if (acc == "")
      // initial value
      return name;
    return acc + ", " + name;
  },
  "",
);
// name_list2 == "" when names is empty.
```

### 参见

- Array.prototype.reduce()
- Array.prototype.reduceRight()
- TypedArray.prototype.reduce()
- TypedArray.prototype.reduceRight()
- Array
- TypedArray
- Array.prototype.filter()
- TypedArray.prototype.filter()

## TypeError: setting getter-only property "x"

### 错误提示

```plain
TypeError: setting getter-only property "x" (Firefox)
TypeError: Cannot set property "prop" of #<Object> which has only a getter (Chrome)
```

### 错误类型

仅在严格模式下报 TypeError 错误。

### 哪里出错了？

该错误提示出现于试图给一个仅仅设置了 getter 特性的属性赋新值的时候。在非严格模式下会被静默忽略，而在严格模式下会报 TypeError 错误。

### 示例

下面的例子展示了如何为一个属性设置 getter 特性。由于没有设置 setter 特性，所以在试图将 temperature 属性值设置为 30 的时候会报 TypeError 的错误。相关细节信息可以参考 Object.defineProperty() 页面。

```js
"use strict";

function Archiver() {
  var temperature = null;
  Object.defineProperty(this, "temperature", {
    get: function () {
      console.log("get!");
      return temperature;
    },
  });
}

var arc = new Archiver();
arc.temperature; // 'get!'

arc.temperature = 30;
// TypeError: setting getter-only property "temperature"
```

至于修复问题的方法，可以将第 16 行的代码移除，因为它试图为 temperature 属性赋值，或者是为它添加一个 setter 特性，就像下面这样：

```js
"use strict";

function Archiver() {
  var temperature = null;
  var archive = [];

  Object.defineProperty(this, "temperature", {
    get: function () {
      console.log("get!");
      return temperature;
    },
    set: function (value) {
      temperature = value;
      archive.push({ val: temperature });
    },
  });

  this.getArchive = function () {
    return archive;
  };
}

var arc = new Archiver();
arc.temperature; // 'get!'
arc.temperature = 11;
arc.temperature = 13;
arc.getArchive(); // [{ val: 11 }, { val: 13 }]
```

### 相关内容

- Object.defineProperty()
- Object.defineProperties()

## URIError: malformed URI sequence

当 URI 编码或解码没有成功完成时，JavaScript 会抛出“malformed URI sequence”异常。

### 错误信息

```plain
URIError: URI malformed (V8-based)
URIError: malformed URI sequence (Firefox)
URIError: String contained an illegal UTF-16 sequence. (Safari)
```

### 错误类型

URIError

### 什么地方出错了？

URI 编码和解码不成功。传递给 decodeURI、encodeURI、encodeURIComponent 或 decodeURIComponent 函数的参数不合法，导致函数无法正确对其进行编解码。

### 示例

#### 编码

编码操作会将每一个字符实例替换为一到四个相对应的 UTF-8 编码形式的转义序列。如果试图编码一个非高—低位完整的代理字符，将会抛出 URIError 错误，例如：

```js
encodeURI("\uD800");
// "URIError: malformed URI sequence"

encodeURI("\uDFFF");
// "URIError: malformed URI sequence"
```

高—低位完整的代理字符是没问题的，例如：

```js
encodeURI("\uD800\uDFFF");
// "%F0%90%8F%BF"
```

#### 解码

解码操作则是将已经经过编码的 URL 片段中的每一个转义序列替换为相对应的字符。如果相应的字符不存在，就会抛出错误：

```js
decodeURIComponent("%E0%A4%A");
// "URIError: malformed URI sequence"
```

输入没问题的话，通常是下面这样：

```js
decodeURIComponent("JavaScript_%D1%88%D0%B5%D0%BB%D0%BB%D1%8B");
// "JavaScript_шеллы"
```

### 参见

- URIError
- decodeURI
- encodeURI
- encodeURIComponent
- decodeURIComponent

## Warning: -file- is being assigned a //# sourceMappingURL, but already has one

当给定的 JavaScript 源文件被指定了多次源码映射时，JavaScript 会发出“-file- is being assigned a //# sourceMappingURL, but already has one.”警告。

### 错误信息

```plain
Warning: -file- is being assigned a //# sourceMappingURL, but already has one.
```

### 错误类型

警告。JavaScript 的执行不会中止。

### 什么地方出错了？

对于给定的 JavaScript 源码，源码映射规定了不止一次。

JavaScript 源码通常被组合和压缩，使其从服务器传递更加高效。使用[源码映射](https://www.html5rocks.com/en/tutorials/developertools/sourcemaps/)，调试器能够将执行的源码映射到原始的源码。有两种指派源码映射的方式，通过注释，或者对 JavaScript 设置标头。

### 示例

#### 设置源码映射

使用文件中的注释来设置源码映射：

```js
//# sourceMappingURL=http://example.com/path/to/your/sourcemap.map
```

或者，你可以对你的 JavaScript 文件设置标头：

```js
X-SourceMap: /path/to/file.js.map
```

### 参见

- 火狐源代码文档中的[使用源码映射](https://firefox-source-docs.mozilla.org/devtools-user/debugger/how_to/use_a_source_map/index.html)
- 在 developer.chrome.google.cn 上的 [JavaScript 源码映射简介](https://developer.chrome.google.cn/blog/sourcemaps)（2012）

## Warning: unreachable code after return statement

当在 return 语句之后使用别的语句，或在无分号返回语句之后直接在后面跟随表达式，会出现 JavaScript 警告“unreachable code after return statement”。

### 错误信息

```plain
Warning: unreachable code after return statement (Firefox)
```

### 错误类型

警告

### 什么地方出错了？

在 `return` 语句之后的不可达的语句会在下列情形中产生：

- 在 return 语句之后出现其他表达式；
- 在省略分号的 return 语句之后直接跟随一个表达式。

当一个表达式出现在一个有效的 `return` 表达式之后时，会出现这个警告，用以说明在 `return` 语句之后的表达式不可达，即这条语句之后的表达式永远不会运行。

为什么需要在 `return` 语句之后添加分号？在省略分号的 `return` 语句之后，开发者想要终止当前函数的执行还是返回 return 之后表达式的结果的意图是不明确的。这个警告表明这种情况下 `return` 语句的表述具有二义性。

当在省略分号的 return 语句之后出现下列语句时，不会出现警告：

- throw
- break
- var
- function

### 示例

#### 无效的例子

```js
function f() {
  let x = 3;
  x += 4;
  return x;   // return 立刻退出函数
  x -= 3;     // 因此这一行永远不会执行；它是不可到达的代码。
}

function g() {
  return     // 这被视为 `return;`
    3 + 4;   // 因此函数返回，这行永不执行。
}
```

#### 有效的例子

```js
function f() {
  let x = 3;
  x += 4;
  x -= 3;
  return x; // OK：在所有其他语句之后返回。
}

function g() {
  return 3 + 4 // OK：在同一行上，无需分号的返回表达式。
}
```

### 参见

- 自动分号补全

## X.prototype.y called on incompatible type

### 错误提示

```plain
TypeError: Function.prototype.toString called on incompatible object (Firefox)
TypeError: Function.prototype.bind called on incompatible target (Firefox)
TypeError: Method Set.prototype.add called on incompatible receiver undefined (Chrome)
TypeError: Bind must be called on a function (Chrome)
```

### 错误类型

TypeError

### 哪里出错了？

当这个错误被抛出时，属于某个对象的函数被调用，但是没有提供给 `this` 与其所期望的函数类型一致的参数。

在调用 Function.prototype.call() 或Function.prototype.apply() 方法，但是为 `this` 提供的绑定对象与预期的不匹配时，这个问题就会出现。

该问题还会出现于将一个（存储在一个对象中的）函数提供给另外一个函数作为参数时。在这种情况下，函数所在的对象并非该函数的 `this` 绑定的目标对象。为了解决这个问题，你或者为其提供一个 lambda 表达式，该表达式完成函数要完成的任务，或者调用 Function.prototype.bind() 函数为 `this` 强制绑定期望的对象。

### 示例

#### 错误示例

```js
var mySet = new Set();
["bar", "baz"].forEach(mySet.add);
// mySet.add is a function, but "mySet" is not captured as this.

var myFun = function () {};
["bar", "baz"].forEach(myFun.bind);
// myFun.bind is a function, but "myFun" is not captured as this.
```

#### 正确示例

```js
var mySet = new Set();
["bar", "baz"].forEach(mySet.add.bind(mySet));
// This works due to binding "mySet" as this.

var myFun = function () {};
["bar", "baz"].forEach((x) => myFun.bind(x));
// This works using the "bind" function. It creates a lambda forwarding the argument.
```

### 相关内容

- Function.prototype.call()
- Function.prototype.apply()
- Function.prototype.bind()
