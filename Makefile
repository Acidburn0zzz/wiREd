
all: analyzer.jsc

analyzer.jsc: disasm/arch-x86.js disasm/arch-8051.js | node_modules

test: all Password.dll.analyzed

out/%.compiled.js: %.js
	@deps/traceur-compiler/traceurc --source-maps --freeVariableChecker=false "$<"

%.jsc: out/%.compiled.js
	@echo "!global.traceur && (0,eval)(require('fs').readFileSync(__dirname+'/deps/traceur-compiler/bin/traceur.js', 'utf8'));" | cat - "$<" > "$@"

disasm/%.jsc: out/disasm/%.compiled.js
	@echo "!global.traceur && (0,eval)(require('fs').readFileSync(__dirname+'/../deps/traceur-compiler/bin/traceur.js', 'utf8'));" | cat - "$<" > "$@"

disasm/arch-%.js: disasm/%.jsc disasm/Disasm.jsc
	@node "$<" > /dev/null

node_modules: package.json
	@npm install
	@touch node_modules

%.analyzed: % analyzer.jsc | windows.h
	@node --stack_trace_limit=64 analyzer.jsc ${ANALYSIS_ARGS} "$<" > "$@" 2>&1

%.analyzed.html: %.analyzed deps/highlight.html
	@echo "<pre lang=js>" > "$@"
	@cat "$<" >> "$@"
	@echo "</pre>" >> "$@"
	@cat deps/highlight.html >> "$@"

windows.h: deps/windows.h
	@gcc -Ideps/mingw-w64/mingw-w64-{crt/include,headers/{crt,include}} -m32 -E -P "$<" > "$@"

Password.dll:
	@wget -O "$@" http://eu.depot.battle.net:1119/8f52906a2c85b416a595702251570f96d3522f39237603115f2f1ab24962043c.auth

clean:
	-rm -rf out disasm/*.jsc disasm/arch-*.js *.jsc *.analyzed

.PRECIOUS: node_modules %.jsc disasm/%.jsc disasm/arch-%.js %.analyzed

.PHONY: all test clean
