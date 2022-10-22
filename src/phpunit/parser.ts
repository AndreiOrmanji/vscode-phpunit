import { Class, Declaration, Engine, Namespace, Node, Program, UseGroup } from 'php-parser';

const engine = new Engine({
    ast: { withPositions: true, withSource: true },
    parser: { php7: true, debug: false, extractDoc: true, suppressErrors: false },
    lexer: {
        all_tokens: true,
        comment_tokens: true,
        mode_eval: true,
        asp_tags: true,
        short_tags: true,
    },
});

const getName = (ast: Namespace | Class | Declaration) => {
    return typeof ast.name === 'string' ? ast.name : ast.name.name;
};

const generateId = (qualifiedClazz: string, method: string) => {
    return `${qualifiedClazz}::${method}`;
};

const generateQualifiedClazz = (clazz: string, namespace?: string) => {
    return [namespace, clazz].filter((name) => !!name).join('\\');
};

const isAnnotationTest = (declaration: Declaration) => {
    return !declaration.leadingComments
        ? false
        : /@test/.test(declaration.leadingComments.map((comment) => comment.value).join('\n'));
};

const isTest = (declaration: Declaration) => {
    if (declaration.kind !== 'method') {
        return false;
    }

    if (isAnnotationTest(declaration)) {
        return true;
    }

    return getName(declaration).startsWith('test');
};

const parseAnnotation = (declaration: Declaration, annotation = '@depends') => {
    const pattern = new RegExp(`${annotation}\\s+[^\\n\\s]+`, 'g');

    const match = (comment: string) => {
        return (comment.match(pattern) || [])
            .map((match: string) => match.replace(annotation, '').trim())
            .filter((match: string) => !!match);
    };

    return !declaration.leadingComments
        ? undefined
        : declaration.leadingComments.reduce((acc, comment) => {
              return acc.concat(match(comment.value) ?? []);
          }, [] as string[]);
};

const travel = (
    ast: Program | Namespace | UseGroup | Class | Node,
    filename: string,
    namespace?: Namespace
): TestCase[] | undefined => {
    if (ast.kind === 'usegroup') {
        return;
    }

    if (ast.kind === 'namespace') {
        namespace = ast as Namespace;
    }

    if (ast.kind === 'class') {
        const clazz = ast as Class;

        return clazz.body
            .filter((declaration) => isTest(declaration))
            .map((declaration) => new TestCase(filename, declaration, clazz, namespace));
    }

    if ('children' in ast) {
        return ast.children.reduce(
            (acc, children: Node) => acc.concat(travel(children, filename, namespace) ?? []),
            [] as TestCase[]
        );
    }
};

export class TestCase {
    public readonly id: string;
    public readonly qualifiedClazz: string;
    public readonly namespace?: string;
    public readonly clazz: string;
    public readonly method: string;
    public readonly start: { character: number; line: number };
    public readonly end: { character: number; line: number };
    public readonly annotations: { depends?: string[] };

    constructor(
        private readonly filename: string,
        declaration: Declaration,
        clazz: Class,
        namespace?: Namespace
    ) {
        this.namespace = namespace ? getName(namespace) : undefined;
        this.clazz = getName(clazz);
        this.method = getName(declaration);
        this.qualifiedClazz = generateQualifiedClazz(this.clazz, this.namespace);
        this.id = generateId(this.qualifiedClazz, this.method);
        this.annotations = {
            depends: parseAnnotation(declaration),
        };

        const loc = declaration.loc!;
        this.start = { line: loc.start.line, character: loc.start.column };
        this.end = { line: loc.start.line, character: loc.source?.length ?? 0 };
    }

    public toJSON() {
        const { filename, id, namespace, qualifiedClazz, clazz, method, start, end } = this;

        return { filename, id, namespace, qualifiedClazz, clazz, method, start, end };
    }
}

export const parse = (buffer: Buffer | string, filename: string) => {
    const ast = engine.parseCode(buffer.toString(), filename);

    return travel(ast, filename);
};