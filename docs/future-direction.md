# 🗺️ Vue DeadFinder 향후 방향성 및 로드맵 (Future Direction)

이 문서는 Vue DeadFinder 프로젝트의 다음 개발 단계(Phase 2 및 Phase 3)의 세부 설계 및 방향성을 정의합니다. Core Graph Engine(`@deadfinder/core`)과 CLI(`@deadfinder/cli`) 구축 이후, IDE 확장 및 프레임워크 연계 고도화를 목표로 합니다.

---

## 1. Phase 2: IDE Client 연동 및 탐색기 시각화 (v1.5)

목표: 개발자가 코드를 수정할 때 별도의 명령어를 실행하지 않고도, **IDE 파일 탐색기에서 데드 코드를 실시간으로 인지**하게 합니다.

### 1.1 VS Code Extension (`packages/vscode`)
* **데코레이션 API:** `vscode.FileDecorationProvider`를 연동하여 파일 탐색기 내 색상과 배지를 수정합니다.
  - **데드 파일 (Dead File):** 파일명 색상을 회색(`Disabled Foreground`)으로 전환하고, 파일 우측에 **`[D]`** 배지 부착.
  - **데드 수출 보유 파일 (Unused Export):** 파일명은 유지하되 우측에 **`[U]`** (Unused) 배지 부착.
* **커맨드 연동:** 파일 컨텍스트 메뉴(우클릭) ➡️ `DeadFinder: Explain Why Dead` 실행 시 전용 아웃풋 채널(Output Channel)에 도달 실패 경로 및 상세 원인(Trace)을 출력합니다.

### 1.2 WebStorm / IntelliJ Plugin (`packages/webstorm`)
* **데코레이션 API:** `ProjectViewNodeDecorator`를 상속받아 프로젝트 뷰 노드를 꾸밉니다.
  - **데드 파일 (Dead File):** 폰트 색상을 연회색으로 채색하고 취소선 처리. 파일 아이콘에 ☠️ 혹은 ❌ 오버레이 장식 추가.
  - **데드 수출 보유 파일 (Unused Export):** 노드 우측에 경고 도트(Dot) 배지 생성.
* **이벤트 기반 갱신:** `PsiTreeChangeListener`를 구현하여 PSI(Program Structure Interface) 트리의 변경 사항을 실시간으로 감지합니다.

### 1.3 초고속 증분 분석 엔진 (Incremental Engine)
4,000개 이상의 대형 프로젝트에서 **저장 시 50ms 이내**로 탐색기에 결과를 반영하기 위해 전체 그래프 재분석 대신 증분 계산 방식을 사용합니다.

```text
[ 파일 'B.ts' 수정 완료 및 저장 ]
             │
             ▼
1. IDE File Watcher가 파일 변경 감지
             │
             ▼
2. Incoming Edges 역추적 ➡️ 영향 받는 상위 노드 A 및 하위 노드 C 마킹
             │
             ▼
3. 'B.ts' 단일 파일만 Re-parsing & Re-indexing 수행 (로컬 그래프 갱신)
             │
             ▼
4. 서브트리 국소 BFS/DFS Traversal 실행 (전체 그래프 순회 대비 99% 성능 단축)
             │
             ▼
5. 변경된 노드만 IDE FileDecoration Provider에 부분 UI Update 이벤트 발생 (< 50ms)
```

---

## 2. Phase 3: Vue 심층 의미 분석 확장 (v2.0)

목표: 단순 파일/심볼 수준의 의존성을 넘어 **Vue 프레임워크 에코시스템의 세부 도달 가능성**까지 의미론적으로 추적합니다.

### 2.1 Unused Props / Emits / Slots Query
부모 컴포넌트와 자식 컴포넌트 간의 결합을 추적합니다.
- **Props 추적:** 자식 컴포넌트에서 정의한 `defineProps` 필드가 부모 템플릿 바인딩에서 쓰이지 않는 경우 경고 배지 표시.
- **Emits 추적:** 자식에서 `defineEmits`로 정의한 이벤트가 부모 템플릿 `@event`에서 구독되지 않는 경우 감지.
- **Slots 추적:** `<slot name="header">`가 제공되었으나 부모에서 `#header`로 채워지지 않는 유효하지 않은 슬롯 감지.

### 2.2 Unused Pinia Store Query
애플리케이션 전역 상태 관리 모듈의 정적 분석을 진행합니다.
- `defineStore()`로 정의된 Pinia 스토어 내에서, 어떤 State/Getter/Action이 컴포넌트나 다른 스토어에서 참조되지 않는지 기하학적 관계를 추적합니다.
- 쓰이지 않는 스토어 상태를 경고하여 리팩토링 범위를 크게 좁힙니다.

### 2.3 Unused Router & Assets Query
- **라우트 데드코드:** `vue-router` 설정 파일의 `routes` 배열을 추적하고, 동적 로딩 대상인 컴포넌트와 주소(path)가 실제로 사용자 네비게이션 트리에서 도달 가능한지 분석합니다.
- **자산(Assets) 데드코드:** 코드나 템플릿(src 속성, import 구문)에서 전혀 불려오지 않는 `assets/` 하위 이미지, 폰트, 미디어 파일들을 찾아내 번들 크기 축소에 기여합니다.

---

## 3. 궁극적인 진화 방향 (Next Step)

Vue DeadFinder는 단순 정적 분석기를 넘어 **'Refactoring Companion'**으로 진화하고자 합니다.
- **Auto-Prune (자동 가지치기):** `deadfinder prune` 실행 시 안전하게 삭제가 보장되는 DEAD 파일(Orphan 파일 등)들을 자동 백업 후 소스 트리에서 영구 격리/삭제하는 기능.
- **GitHub Actions / CI Reporter:** PR 생성 시 데드코드가 추가되었는지 체크하여 변경 파일 대비 데드코드 누적률을 커멘트로 시각화해 피드백하는 Bot 연동.
