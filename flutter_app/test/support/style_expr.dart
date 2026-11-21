/// A small evaluator for the MapLibre style expressions the building height uses, so a test can run the REAL style
/// expression (from the committed template) and compare it with the Dart reference implementation. It knows only the
/// operators below and throws on anything else, so the style cannot quietly start using an operator the test does not
/// check. Semantics follow the MapLibre style spec; `to-number` follows its rules (null and false give 0, an empty or
/// blank string gives 0, a string that is not a number tries the next argument).
Object? evalExpr(Object? e, {required Map<String, Object?> props, int? id, Map<String, Object?> vars = const {}}) {
  if (e is! List) return e;
  if (e.isEmpty) throw ArgumentError('empty expression');
  final op = e.first as String;
  Object? ev(Object? x) => evalExpr(x, props: props, id: id, vars: vars);
  num n(Object? x) {
    final v = ev(x);
    if (v is num) return v;
    throw StateError('expected a number, got $v in $e');
  }

  switch (op) {
    case 'literal':
      return e[1];
    case 'get':
      return props[e[1] as String];
    case 'id':
      return id;
    case 'has':
      return props.containsKey(e[1] as String);
    case 'var':
      return vars[e[1] as String];
    case 'let':
      final scope = Map<String, Object?>.of(vars);
      for (var i = 1; i < e.length - 1; i += 2) {
        scope[e[i] as String] = evalExpr(e[i + 1], props: props, id: id, vars: scope);
      }
      return evalExpr(e.last, props: props, id: id, vars: scope);
    case 'to-number':
      for (var i = 1; i < e.length; i++) {
        final v = ev(e[i]);
        if (v == null || v == false) return 0;
        if (v == true) return 1;
        if (v is num) {
          if (v.isFinite) return v;
          continue;
        }
        if (v is String) {
          if (v.trim().isEmpty) return 0;
          final p = double.tryParse(v);
          if (p != null && p.isFinite) return p;
        }
      }
      throw StateError('to-number: no input could be converted in $e');
    case '==':
      final a = ev(e[1]), b = ev(e[2]);
      if (a is num && b is num) return a == b;
      return a == b;
    case '>':
      return n(e[1]) > n(e[2]);
    case '*':
      return e.skip(1).map(n).fold<num>(1, (a, b) => a * b);
    case '+':
      return e.skip(1).map(n).fold<num>(0, (a, b) => a + b);
    case '%':
      return n(e[1]).toDouble() % n(e[2]).toDouble();
    case 'max':
      return e.skip(1).map(n).reduce((a, b) => a > b ? a : b);
    case 'min':
      return e.skip(1).map(n).reduce((a, b) => a < b ? a : b);
    case 'all':
      for (var i = 1; i < e.length; i++) {
        if (ev(e[i]) != true) return false;
      }
      return true;
    case 'case':
      for (var i = 1; i + 1 < e.length; i += 2) {
        if (ev(e[i]) == true) return ev(e[i + 1]);
      }
      return ev(e.last);
  }
  throw UnsupportedError('style_expr.dart does not know the operator "$op"');
}
