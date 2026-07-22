# 🔍 Vue DeadFinder (`@deadfinder/graph`)

Vue DeadFinder는 Vue 3 및 TypeScript 애플리케이션에서 파일, 심볼, 템플릿 간의 의존성 관계를 추적하도록 설계된 의미론적 의존성 그래프 엔진이자 IDE 도구 모음입니다. 지정된 진입점(Entry Point)으로부터 코드의 도달 가능성(Reachability)을 매핑하여 사용하지 않는 파일과 내보내기(Export)를 시각적으로 감출 수 있게 돕습니다.

---

## 🚀 주요 기능

1. **파일-심볼 하이브리드 양방향 그래프:** 파일 및 내보내기(Export), 재내보내기(Re-export), 로컬 변수 사용처를 정밀하게 추적하여 확실한 코드 도달 가능성을 판별합니다.
2. **Vue 컴포넌트 심층 분석:** Vue SFC 템플릿을 파싱하여 컴포넌트 태그, 이벤트 핸들러(예: `@click="handler"`), 데이터 바인딩, 슬롯(Slot) 주입 여부를 정적 대조하여 오탐지(False Positive)를 차단합니다.
3. **Pinia 스토어 정적 분석:** 정의된 스토어(`defineStore`)를 파싱하여 스토어가 사용되고 있더라도 그 내부에서 실제로 접근되지 않는 State, Getter, Action 멤버를 탐색 및 보고합니다.
4. **Vue Router 및 정적 자산(Assets) 분석:** 라우팅 테이블에 등록되어 있으나 서비스 내에서 접근되지 않는 라우트 경로, `src/assets` 폴더 내에서 한 번도 참조되지 않는 정적 이미지/미디어 자산 파일을 검출합니다.
5. **CI/CD 통합 검사:** 빌드 파이프라인(GitHub Actions 등)에 연동하여 데드코드 개수가 설정된 허용치보다 많을 때 빌드를 실패 처리하거나 경고를 띄울 수 있습니다.
6. **자동 가지치기 (Auto-Prune):** 미사용으로 판정된 파일과 자산을 안전하게 일괄 삭제합니다. `--dry-run`으로 미리 볼 수 있고, 기본적으로 삭제 전에 프로젝트 내 `.deadfinder-backup/` 폴더로 자동 백업합니다.
7. **양방향 역추적 설명 (`explain`):** 살아있는 파일에 대해서는 진입점으로부터 이르는 도달 경로(Trace Path)를 보여주며, 죽은 파일에 대해서는 어떤 데드 파일들이 이 파일을 참조하고 있는지를 역추적해 줍니다.
8. **플랫폼 독립형 엔진:** 코어 그래프 엔진은 모듈화된 Node.js API로 컴파일되어 IDE 플러그인(VS Code, WebStorm) 및 CLI 도구로 손쉽게 호환됩니다.

---

## 📁 레포지토리 구조

```text
vue-deadcode/
├── packages/
│   ├── core/              # @deadfinder/core (하이브리드 양방향 그래프 코어 엔진)
│   ├── cli/               # @deadfinder/cli (명령줄 인터페이스 및 CI/CD 도구)
│   └── vscode/            # @deadfinder/vscode (VS Code 확장 프로그램)
├── docs/                  # 프로젝트 요구사항 및 아키텍처 설계 문서
└── tests/
    └── fixtures/          # 테스트용 모의 프로젝트 (Vite/Vue 3 앱 구조)
```

---

## 🛠️ 시작하기

### 사전 요구사항

- [Node.js](https://nodejs.org/) (v18 이상)
- [pnpm](https://pnpm.io/) (v8 이상)

### 패키지 설치

레포지토리를 클론하고 루트 디렉토리에서 의존성 패키지를 설치합니다:

```bash
pnpm install
```

### 빌드

코어 엔진, CLI 및 VS Code 패키지를 한 번에 컴파일합니다:

```bash
pnpm build
```

---

## 💻 CLI 명령어 사용법

CLI 명령어는 `@deadfinder/cli`를 통해 실행됩니다. 빌드 완료 후 노드로 직접 구동할 수 있습니다.

### 1. 프로젝트 분석 (`analyze`)

미사용 파일, 내보내기, 스토어 멤버 및 정적 자산을 스캔하여 요약 보고서 또는 상세 JSON 결과를 반환합니다:

```bash
# 텍스트 형식 요약 리포트 출력
node packages/cli/dist/index.js analyze --project tests/fixtures/mock-project

# JSON 형식 상세 출력
node packages/cli/dist/index.js analyze --project tests/fixtures/mock-project --format json
```

### 2. CI 파이프라인 검사 (`check`)

데드 파일 개수가 지정된 한계를 초과하면 Exit Code `1`을 반환하여 배포 빌드를 중단시킵니다:

```bash
node packages/cli/dist/index.js check --project tests/fixtures/mock-project --max-dead-files 2
```

### 3. 도달 가능 경로 설명 (`explain`)

살아있는 파일은 진입점에서의 추적 경로를 보여주고, 죽은 파일은 참조 관계 흐름을 역추적합니다:

```bash
# 살아있는 컴포넌트 추적
node packages/cli/dist/index.js explain src/components/MyButton.vue --project tests/fixtures/mock-project

# 죽은 컴포넌트 추적
node packages/cli/dist/index.js explain src/components/UnusedComponent.vue --project tests/fixtures/mock-project
```

### 4. 자동 가지치기 (`prune`)

사용하지 않는 파일과 이미지를 정리합니다. 기본적으로 파일들은 프로젝트 루트의 `.deadfinder-backup/`으로 이동 보관됩니다.

```bash
# 드라이 런 (실제 삭제하지 않고 대상만 미리 보기)
node packages/cli/dist/index.js prune --project tests/fixtures/mock-project --dry-run

# 백업 이동을 동반한 가지치기 실행
node packages/cli/dist/index.js prune --project tests/fixtures/mock-project

# 백업 폴더 없이 영구 삭제 실행
node packages/cli/dist/index.js prune --project tests/fixtures/mock-project --force
```

---

## 🔌 IDE 개발 툴 연동

### 1. VS Code 확장 프로그램 빌드 및 설치

개발된 확장을 VS Code에 로드하여 실시간으로 BADGE 및 풍선 도움말 알림을 받으실 수 있습니다.

#### 패키지 파일(`.vsix`) 빌드
VS Code 패키지 폴더로 이동하여 바이너리 설치 파일을 생성합니다:
```bash
cd packages/vscode
npx vsce package
```
*(성공 시 폴더 내에 `vue-deadfinder-vscode-1.0.0.vsix` 파일이 생성됩니다).*

#### 에디터에 수동 설치
1. **VS Code**를 실행합니다.
2. 좌측 메뉴의 **Extensions (확장 탭, `Ctrl+Shift+X`)**으로 이동합니다.
3. Extensions 탭 우측 상단의 **`...` (더보기 메뉴)** 아이콘을 클릭합니다.
4. **Install from VSIX...**를 선택합니다.
5. 빌드 완료된 `vue-deadfinder-vscode-1.0.0.vsix` 패키지를 선택해 설치합니다.

설치가 완료되면 일반 Vue 프로젝트 폴더를 열고 수정 후 저장 시 자동으로 미사용 자원들이 탐색기에 시각화됩니다.

---

### 2. 웹스톰 (WebStorm) 연동

웹스톰에서는 CLI 분석기를 **External Tool (외부 도구)**로 등록하여 마우스 우클릭 및 단축키로 분석 리포트를 즉시 출력할 수 있습니다.

#### 외부 도구로 DeadFinder 등록하기
1. 웹스톰 설정(`Ctrl+Alt+S` 또는 `Preferences`)을 엽니다.
2. **Tools -> External Tools** 메뉴로 이동합니다.
3. 우측 상단의 **`+` (추가)** 아이콘을 눌러 새 항목을 등록합니다:
   - **Name:** `DeadFinder Analyze`
   - **Group:** `DeadFinder`
   - **Program:** `node` (글로벌 설치 시 `deadfinder` 입력 가능)
   - **Arguments:** `프로젝트_절대_경로/packages/cli/dist/index.js analyze --project $ProjectFileDir$`
   - **Working directory:** `$ProjectFileDir$`
4. **OK**를 눌러 설정을 마칩니다.

#### 실행 방법
프로젝트 사이드바의 폴더/파일을 선택하고 **우클릭 -> External Tools -> DeadFinder -> DeadFinder Analyze**를 선택하면 내장 실행 창(Run Console)에 분석 리포트가 깔끔하게 출력됩니다.

---

## 🧪 테스트 코드 구동

Vitest를 활용하여 유닛 및 통합 기능 테스트를 수행합니다:

```bash
pnpm test
```

---

## ⚙️ 세부 기술 메커니즘

- **모듈 해석(Module Resolution):** `@/`와 같은 별칭(Alias) 분석 지원, 폴더 하위의 `index.ts` 자동 매핑, TypeScript ESM 규격 확장자(`.js`로 작성했으나 실제 파일은 `.ts`인 경우)의 물리적 실제 경로 변환을 수행합니다.
- **가상 기본 내보내기(Implicit Default Export):** 내보내기 명시가 생략되는 Vue SFC 파일들에 대해 컴포넌트 해석용 가상 export를 백그라운드에서 임시 주입하여 종속 그래프 일관성을 보존합니다.
- **동적 컴포넌트 세이프티 가드:** `<component :is="var" />`와 같이 런타임에 결정되는 템플릿 변수가 감지될 시, 해당 소스 경로의 컴포넌트들에 대한 분석을 유예하여 빌드 도중 실사용 코드가 삭제되는 현상을 방지합니다.
