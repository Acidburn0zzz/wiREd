export const binaryOps = {
    Mov:'=',
    // Arithmethic operators.
    Add: '+', Mul: '*', Div: '/',
    // Bitwise operators.
    And: '&', Or: '|', Xor: '^',

    // Comparison operators.
    Eq: '==', Lt: '<',

    // Bit-shift operators.
    Shl: '<<', Shr: '>>'
}, unaryOps = {
    Not: '~', Neg: '-'
}, precendence = {
    '()':1, '[]':1,
    '~':2,
    '*':3, '/':3, '%':3,
    '+':4, '-':4,
    '<<':5, '>>':5,
    '<':6,
    '==':7,
    '&':8,
    '^':9,
    '|':10,


    '=':13,
    ',':14
}, intBitSizes = [1, 8, 16, 32, 64, 128, 256],
floatBitSizes = [32, 64, 80, 128],
storageBitSizes = [1, 8, 16, 32, 64, 80, 128, 256];

export var code = '';

code += `

var _inspect = (typeof require !== 'undefined' ? require('util').inspect : function(x) {/*HACK*/return JSON.stringify(x, 0, 2);});

var bitsof = exports.bitsof = function bitsof(x) {
    if(typeof x === 'object' && 'bitsof' in x)
        return x.bitsof;
    throw new TypeError('Missing bit size for '+inspect(x));
}

var sizeof = exports.sizeof = function sizeof(x) {
    return Math.ceil(bitsof(x)/8);
}

var valueof = exports.valueof = function valueof(x) {
    if(x.known)
        return x;
    var v = x.value;
    if(v === null || v === void 0)
        return x;
    return v;
}

var lvalueof = exports.lvalueof = function lvalueof(x) {
    if(typeof x !== 'object' || !('lvalue' in x))
        return valueof(x);
    var v = x.lvalue;
    if(v === null || v === void 0)
        return x;
    return v;
}

var inspect = exports.inspect = function inspect(x, p) {
    if(typeof x === 'object' && x.inspect)
        return x.inspect(0, p || 16);
    return _inspect(x);
}

var Unknown = exports.Unknown = function Unknown(bits) {
    // HACK int[bits] - signed because it can promote to unsigned if required.
    if(typeof bits === 'number') {
        this.bitsof = bits;
        this.signed = true;
        this.type = int[bits];
        this.isInteger = true;
    }
}
Unknown.prototype = {
    constructor: Unknown, known: false`;

for(let fn in unaryOps) {
    let op = unaryOps[fn], fnLower = fn.toLowerCase();
    code += `,
    ${fnLower}: function ${fnLower}() {
        return new ${fn}(this);
    }`;
}

for(let fn in binaryOps) {
    let op = binaryOps[fn], fnLower = fn.toLowerCase();
    if(op === '<<' || op === '>>')
        code += `,
    ${fnLower}: function ${fnLower}(that) {
        return new ${fn}(this, that);
    }`;
    else
        code += `,
    ${fnLower}: function ${fnLower}(that) {
        if(this.isInteger >= that.isInteger && that.bitsof > this.bitsof || that.bitsof === this.bitsof && that.signed < this.signed) { // that.type > this.type
            if(!that.isInteger || that.known)
                return (new that.type(this)).${fnLower}(that);
            return ${op === '<' ? `/*HACK < is the only non-commutative operator */ that.lt(this).not().and(that.eq(this).not())` : `that.${fnLower}(this)`};
        }
        return new ${fn}(this, that);
    }`;
}

code += `,
    sub: function sub(that) {
        if(that.isInteger && (!that.signed || that.bitsof < this.bitsof)) // HACK cleaner output
            that = int[this.bitsof](that);
        return this.add(that.neg());
    },
    rol: function rol(that) {
        return this.shl(that).or(this.shr(u8(this.bitsof).sub(that)));
    },
    ror: function ror(that) {
        return this.shr(that).or(this.shl(u8(this.bitsof).sub(that)));
    }
};`;

// Operations.
for(let fn in unaryOps) {
    let op = unaryOps[fn], prec = precendence[op];

    code += `
var ${fn} = exports.${fn} = function ${fn}(a) { // assumes !a.known.
    if(a.op === '${op}') return a.a;
    this.a = a;
    this.type = a.type;
    this.bitsof = a.bitsof;
    this.signed = a.signed;
    this.isInteger = a.isInteger;
}
${fn}.prototype = new Unknown;
${fn}.prototype.constructor = ${fn};
${fn}.prototype.fn = '${fn}'; // TODO obsolete?
${fn}.prototype.op = '${op}';
${fn}.prototype.a = null;
${fn}.prototype.type = null;
${fn}.prototype.bitsof = 0;
${fn}.prototype.signed = true;
${fn}.prototype.isInteger = true;
Object.defineProperty(${fn}.prototype, 'value', {get: function() {
    var a = valueof(this.a);
    if(a !== this.a)
        return a.${fn.toLowerCase()}();
}});
${fn}.prototype.inspect = function(_, p) {
    ${op === '~' ? `if(this.bitsof === 1) {
        if(this.a.op === '==') {
            var expr = inspect(this.a.a, ${precendence['==']})+' != '+inspect(this.a.b, ${precendence['==']});
            return ${precendence['==']} <= p ? expr : '('+expr+')'
        }
        if(this.a.op === '<') {
            var expr = inspect(this.a.a, ${precendence['<']})+' >= '+inspect(this.a.b, ${precendence['<']});
            return ${precendence['<']} <= p ? expr : '('+expr+')'
        }
    }
    `: ''}var expr = '${op}'+inspect(this.a, ${prec});
    return ${prec} <= p ? expr : '('+expr+')';
};`;
}

for(let fn in binaryOps) {
    let op = binaryOps[fn], prec = precendence[op], logic = op === '==' || op === '<';
    let prologue = '', p = (...args)=>prologue += '\n    '+String.raw(...args);

    if(op === '+' || op === '|' || op === '^' || op === '<<' || op === '>>' || op === '>>>')
        p`if(b.isInteger && b.bitsof <= 32 && b._A === 0) /* HACK doesn't work > 32bits. */ return a;`;
    if(op === '&')
        p`if(b.isInteger && b.bitsof <= 32 && b._A === 0) /* HACK doesn't work > 32bits. */ return new a.type(0);`;
    if(op === '^')
        p`if(a === b) return new a.type(0);`;
    if(op === '&' || op === '|')
        p`if(a === b) return a;`;
    if(op === '|' || op === '&')
        p`if(b.isInteger && b.known && b.bitsof <= 32 && b._A === (b.signed ? -1 : (-1 >>> (32-b.bitsof)))) /* HACK doesn't work > 32bits. */ return ${op === '|' ? 'b' : 'a'};`;
    if(op === '+' || op === '|' || op === '^' || op === '&')
        p`if(a.op === '${op}' && a.b.known && b.known) return a.a.${fn.toLowerCase()}(a.b.${fn.toLowerCase()}(b));`;
    if(op === '+')
        p`if(a.op === '-' && a.a === b || b.op === '-' && b.a === a) return new a.type(0);`;

    if(op === '=')
        p`if(!(this instanceof ${fn})) return new ${fn}(a, b);`;

    code += `
var ${fn} = exports.${fn} = function ${fn}(a, b) { /* assumes a.type >= b.type and !a.known. */${prologue}
    this.a = a;
    this.b = b;${op === '=' ? '' :`
    this.type = ${logic ? 'u1' : 'a.type'};
    this.bitsof = ${logic ? '1' : 'a.bitsof'};
    this.signed = ${logic ? 'false' : 'a.signed'};
    this.isInteger = ${logic ? 'true' : 'a.isInteger'};`}
}
${fn}.prototype = new Unknown;
${fn}.prototype.constructor = ${fn};
${fn}.prototype.fn = '${fn}'; // TODO obsolete?
${fn}.prototype.op = '${op}';
${fn}.prototype.a = null;
${fn}.prototype.b = null;
${fn}.prototype.type = null;
${fn}.prototype.bitsof = 0;
${fn}.prototype.signed = true;
${fn}.prototype.isInteger = true;
Object.defineProperty(${fn}.prototype, 'value', {get: function() {
    var a = ${op === '=' ? 'l' : ''}valueof(this.a), b = valueof(this.b);
    if(a !== this.a || b !== this.b)
        return ${op === '=' ? `new ${fn}(a, b)` : `a.${fn.toLowerCase()}(b)`};
}});
${fn}.prototype.inspect = function(_, p) {
    var a = this.a, b = this.b;${op === '=' || op === '+' ? `
    var op = '${op}';
    ` : ''}${op === '+' ? `if(b.isInteger && b.bitsof <= 32 && b._A < 0 && b._A !== -1 << (b.bitsof-1)) { // HACK doesn't work > 32bits.
        op = '-';
        b = b.neg();
    } else if(b.op === '-') {
        op = '-';
        b = b.a;
    }` : ''}${op === '=' ? `if(b.op && b.op !== '=' && b.op !== '<->' && b.op !== '==' && b.op !== '<' && b.op !== '-' && b.op !== '~' && (b.a === a || b.a.lvalue === a)) { // HACK the lvalue check might be costy.
        if(b.isInteger && b.op === '+' && b.b.bitsof <= 32 && b.b._A < 0 && b.b._A !== -1 << (b.b.bitsof-1)) { // HACK doesn't work > 32bits.
            op = '-=';
            b = b.b.neg();
        } else {
            op = b.op+'=';
            b = b.b;
        }
    }` : ''}
    var expr = inspect(a, ${prec})+' ${op=='=' || op=='+' ?`'+op+'`:op} '+inspect(b, ${prec});
    return ${prec} <= p ? expr : '('+expr+')';
};`;
}

// Integers.
code += `
var Integer = exports.Integer = function Integer() {}
Integer.prototype = {
    constructor: Integer, isInteger: true,
    get value() {
        if(!this.known) {
            var v = valueof(this._A);
            if(v !== this._A)
                return new this.type(v);
        }
    },
    get lvalue() {
        if(!this.known)
            return this._A.lvalue;
    },
    sub: function sub(that) {
        if(that.isInteger && (!that.signed || that.bitsof < this.bitsof)) // HACK cleaner output
            that = int[this.bitsof](that);
        return this.add(that.neg());
    }
};

var uint = exports.uint = [], int = exports.int = [];
var signed = exports.signed = function(x) {
    return new int[x.bitsof](x);
};
var unsigned = exports.unsigned = function(x) {
    return new uint[x.bitsof](x);
};
`;

// TODO implement operations and inspection for bits > 32.
for(let bits of intBitSizes) {
    for(let signed of [false, true]) {
        let id = (signed ? 'i' : 'u')+bits, dwords = 'abcdefgh'.slice(0, Math.ceil(bits / 32)).split('');
        let conv = signed ? (bits >= 32 ? '>> 0' : '<< '+(32-bits)+' >> '+(32-bits))
                          : (bits >= 32 ? '>>> 0' : '& 0x'+((1<<bits)-1).toString(16));
        let suffix = ['b', , , 'c'/*FIXME better suffix for byte than c from char*/, 's', '', 'l'][Math.log(bits)/Math.LN2|0];

        code += `
var ${id} = ${signed ? '' : 'u'}int[${bits}] = exports.${id} = function ${id}(${dwords.join(', ')}) {
    if(a.type === ${id}) // HACK This should only fix Unknown operations.
        return a;
    if(!(this instanceof ${id}))
        return new ${id}(a);
    if(typeof a === 'number')
        this._A = a ${conv};
    else if(a.isInteger && a.known)
        this._A = a._A ${conv};
    else {
        this.known = false;
        this._A = a instanceof ${(signed ? 'u' : 'i')+bits} || a instanceof ${id} ? a._A : a;
    }
}
${id}.prototype = new Integer;
${id}.prototype.constructor = ${id};
${id}.prototype.type = ${id};
${id}.prototype.bitsof = ${bits};
${id}.prototype.signed = ${signed};
${id}.prototype.known = true;
${dwords.map(x => id+'.prototype._'+x.toUpperCase()).join(' = ')} = 0;
${id}.prototype.inspect = function(_, p) {
    if(this.known)
        return ${bits <= 32 ? (/*signed ? `this._A` : */`(this._A >= 48 ? '0x'+this._A.toString(16) : this._A)`)+`+(/*process.env.DEBUG_INT*/false ? '${signed ? '' : 'u'}${suffix}' : '')` : `'${id}('+`+dwords.map(x => 'this._'+x.toUpperCase()).join(`+', '+`)+`+')'`};
    return (/*process.env.DEBUG_INT*/false || (this._A instanceof Integer || this._A instanceof Unknown) && this._A.type !== ${id}) ? '${id}('+inspect(this._A)+')' : inspect(this._A, p);
};`;

        for(let fn in unaryOps) {
            let op = unaryOps[fn], fnLower = fn.toLowerCase();
            if(bits > 32)
                code += `
${id}.prototype.${fnLower} = Unknown.prototype.${fnLower};`;
            else
                code += `
${id}.prototype.${fnLower} = function ${fnLower}() {
    if(!this.known) // Unknown#${fnLower}
        return new ${fn}(this);
    return new ${id}(${op}this._A);
};`;
        }

        for(let fn in binaryOps) {
            let op = binaryOps[fn], fnLower = fn.toLowerCase(), logic = op === '==' || op === '<';
            if(bits > 32)
                code += `
${id}.prototype.${fnLower} = Unknown.prototype.${fnLower};`;
            else if(op === '<<' || op === '>>')
                code += `
${id}.prototype.${fnLower} = function ${fnLower}(that) { // assumes that is of an integer type.
    if(!this.known || !that.isInteger || !that.known) // Unknown#${fnLower}
        return new ${fn}(this, that);
    return new ${id}(this._A ${op === '>>' && !signed ? '>>>' : op} (that._A & 0x${(bits-1).toString(16)}));
};`;
            else
                code += `
${id}.prototype.${fnLower} = function ${fnLower}(that) { // assumes that is of an integer type.
    if(!that.isInteger || that.bitsof > ${bits}${signed ? ` || that.bitsof === ${bits} && !that.signed` : ''}) { // that.type > this.type
        if(!this.known && that.known) // Unknown#${fnLower}
            return (new that.type(this)).${fnLower}(that);
        return ${op === '<' ? `/*HACK < is the only non-commutative operator */ that.lt(this).not().and(that.eq(this).not())` : `that.${fnLower}(this)`};
    }
    if(!this.known) // Unknown#${fnLower}
        return new ${fn}(this, that);
    if(!that.known)
        return ${op === '<' ? `/*HACK < is the only non-commutative operator */ that.lt(this).not().and(that.eq(this).not())` : `that.${fnLower}(this)`};
    return new ${logic ? 'u1(' : id}(this._A ${op} ${signed ? `that._A` : `(that._A ${conv})`}${logic ? ' ? 1 : 0)' : ''});
};`;
        }

        code += `
${id}.prototype.rol = function rol(that) {
    return this.shl(that).or(this.shr(u8(${bits}).sub(that)));
};
${id}.prototype.ror = function ror(that) {
    return this.shr(that).or(this.shl(u8(${bits}).sub(that)));
};
`;
    }
}

// Float.
code += `
var Float = exports.Float = function Float() {}
var _floatConvertor = new DataView(new ArrayBuffer(8));
Float.prototype = {
    constructor: Float, known: true, isInteger: false,
    get value() {
        if(!this.known) {
            var v = valueof(this._A);
            if(this._A.fn === 'Mem' && this.bitsof <= 64) { // HACK *reinterpret_cast<float*>(addr)
                if(!v.isInteger || v.bitsof !== this.bitsof || !v.known)
                    return; // TODO better support for reinterpret casts.
                _floatConvertor.setInt32(0, v._A | 0, true);
                if(this.bitsof === 32)
                    return new this.type(_floatConvertor.getFloat32(0, true));
                _floatConvertor.setInt32(4, v._B | 0, true);
                return new this.type(_floatConvertor.getFloat64(0, true));
            }
            if(v !== this._A)
                return new this.type(v);
        }
    },
    get lvalue() {
        if(!this.known)
            return this._A.lvalue;
    },
    sub: function sub(that) {
        if(that.isInteger || that.bitsof < this.bitsof) // HACK cleaner output
            that = new this.type(that);
        return this.add(that.neg());
    }
};

var float = exports.float = [];
`;

// TODO implement operations and inspection for floats.
for(let bits of floatBitSizes) {
    let id = 'f'+bits;

    code += `
// TODO how would the
var ${id} = float[${bits}] = exports.${id} = function ${id}(a) {
    if(a.type === ${id}) // HACK This should only fix Unknown operations.
        return a;
    if(!(this instanceof ${id}))
        return new ${id}(a);
    if(typeof a === 'number')
        this._A = a; // TODO actual conversion.
    else if(!a.isInteger && a.known) // FIXME check if it's actually a Float.
        this._A = a._A; // TODO actual conversion.
    else {
        this._A = a instanceof ${id} ? a._A : a;
        this.known = false;
    }
}
${id}.prototype = new Float;
${id}.prototype.constructor = ${id};
${id}.prototype.type = ${id};
${id}.prototype._A = 0;
${id}.prototype.bitsof = ${bits};
${id}.prototype.signed = true;
${id}.prototype.inspect = function() {
    if(this.known)
        return this._A.toString();
    var a = inspect(this._A);
    return (/*process.env.DEBUG_FLOAT*/false || this._A instanceof Float || this._A instanceof Unknown) ? '${id}('+a+')' : a;
};`;

    for(let fn in unaryOps) {
        let op = unaryOps[fn], fnLower = fn.toLowerCase();
        code += `
${id}.prototype.${fnLower} = Unknown.prototype.${fnLower};`;
    }

    for(let fn in binaryOps) {
        let op = binaryOps[fn], fnLower = fn.toLowerCase(), logic = op === '==' || op === '<';
        code += `
${id}.prototype.${fnLower} = Unknown.prototype.${fnLower};`;
    }
}

// Register*.
code += `
var Register = exports.Register = [];`;
for(let bits of storageBitSizes) {
    code += `
function RegisterFrozen${bits}(name, type) {
    this.name = name;
    this.type = type;
}
RegisterFrozen${bits}.prototype = new Unknown(${bits});
RegisterFrozen${bits}.prototype.constructor = RegisterFrozen${bits};
RegisterFrozen${bits}.prototype.name = null;
RegisterFrozen${bits}.prototype.type = null;
RegisterFrozen${bits}.prototype.inspect = function() {
    return this.name;
};
var Register${bits} = Register[${bits}] = exports.Register${bits} = function Register${bits}(name) {
    if(!(this instanceof Register${bits}))
        return new Register${bits}(name);
    var self = this;
    if(name !== undefined)
        this.name = name;
    else
        name = this.name;
    this.lvalueBase = function() {};
    this.lvalueBase.prototype = {
        freeze: function() {
            self.value = new RegisterFrozen${bits}(name + (self.nthValue++).toSubString(), self.type);
        },
        get value() {
            return self.value;
        },
        set value(v) {
            self.value = v;
        },
        inspect: function() {
            return name /*+ (self.nthValue ? self.nthValue.toSubString() : '')*/;
        }
    };
}
Register${bits}.prototype = new Unknown(${bits});
Register${bits}.prototype.constructor = Register${bits};
Register${bits}.prototype.name = '<${bits}>';
Register${bits}.prototype.nthValue = 0;
Register${bits}.prototype.value = null;
Register${bits}.prototype.lvalue = null;
Object.defineProperties(Register${bits}.prototype, {
    lvalue: {
        get: function() {
            var lvalue = new this.lvalueBase, name = this.name + (this.nthValue ? this.nthValue.toSubString() : '');
            lvalue.inspect = function inspect() {
                return name;
            };
            return lvalue;
        }
    }
});
Register${bits}.prototype.inspect = function() {
    return /*typeof this.name === 'string' ?*/ this.name /*: '(R)'+inspect(this.name)*/;
};`;
}

// Mem*.
code += `
var Mem = exports.Mem = {};
Mem.read = function(address, bits) {
    if(/*process.env.DEBUG_MEM*/false)
        console.error('Non-implemented Mem read ['+inspect(address)+']'+bits);
};
Mem.write = function(address, bits, value) {
    if(/*process.env.DEBUG_MEM*/false)
        console.error('Non-implemented Mem write ['+inspect(address)+']'+bits+' = '+inspect(value));
};`;
for(let bits of storageBitSizes) {
    code += `
var Mem${bits} = Mem[${bits}] = exports.Mem${bits} = function Mem${bits}(addr) {
    if(!(this instanceof Mem${bits}))
        return new Mem${bits}(addr);
    this.addr = addr;
};
Mem${bits}.prototype = new Unknown(${bits});
Mem${bits}.prototype.constructor = Mem${bits};
Mem${bits}.prototype.fn = 'Mem';
Mem${bits}.prototype.addr = null;
Object.defineProperties(Mem${bits}.prototype, {
    lvalue: {
        get: function() {
            var v = valueof(this.addr);
            if(v !== this.addr) return new Mem${bits}(v);
        }
    },
    value: {
        get: function() {
            var v = valueof(this.addr), m = Mem.read(v, ${bits});
            if(m !== null && m !== void 0)
                return m;
            if(v !== this.addr) return new Mem${bits}(v);
        },
        set: function(v) {
            return Mem.write(this.addr, ${bits}, v);
        }
    }
});
Mem${bits}.prototype.inspect = function() {
    return '['+inspect(this.addr)+']${bits}';
};
`;
}


// Special functions.
code += `
var If = exports.If = function If(cond, then) {
    if(!(this instanceof If))
        return new If(cond, then);
    //if(cond.known && cond.bitsof <= 32) // HACK doesn't work > 32bits.
    //    return cond._A ? then : Nop(); // HACK Nop was null.
    if(!Array.isArray(then)) // HACK allow the old usage of If.
        then = [then];
    else
        then = then.filter(function(x) {return !!x;}); // HACK this could be too slow.
    this.cond = cond;
    this.then = then;
};
If.prototype = {
    constructor: If, fn: 'If',
    get value() {
        var cond = valueof(this.cond);
        if(cond !== this.cond)
            return new If(cond, this.then);
    },
    inspect: function() {
        var s = 'if('+inspect(this.cond)+') ';
        if(this.then.length === 1)
            return s+inspect(this.then[0])+';';
        s += '{';
        for(var i = 0; i < this.then.length; i++)
            s += (i ? '; ' : '')+inspect(this.then[i]);
        return s + '}';
    }
};

var FnCall = exports.FnCall = function FnCall(name) {
    if(!(this instanceof FnCall)) // HACK this can slow things down, use new in generated code.
        return new (FnCall.bind.apply(FnCall, [null].concat([].slice.call(arguments))));
    this.name = name;
    this.args = [].slice.call(arguments, 1);
};
FnCall.prototype = {
    constructor: FnCall, fn: 'FnCall',
    get value() {
        var changes = false, args = [null, this.name];
        for(var i = 0; i < this.args.length; i++)
            if((args[i+2] = valueof(this.args[i])) !== this.args[i])
                changes = true;
        if(changes)
            return new (FnCall.bind.apply(FnCall, args));
    },
    inspect: function() {
        var s = this.name+'(';
        for(var i = 0; i < this.args.length; i++)
            s += (i ? ', ' : '')+inspect(this.args[i]);
        return s+')';
    }
};

var Nop = exports.Nop = FnCall.bind(null, 'Nop');
var Interrupt = exports.Interrupt = FnCall.bind(null, 'Interrupt');
`;
