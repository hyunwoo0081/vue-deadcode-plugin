# 🗺️ Vue DeadFinder 향후 방향성 및 로드맵 (Future Direction)

이 문서는 Vue DeadFinder 프로젝트의 다음 개발 단계(Phase 2 및 Phase 3)의 세부 설계 및 방향성을 정의합니다. Core Graph Engine과 CLI 구축 이후, IDE 확장 및 프레임워크 연계 고도화를 목표로 합니다.

---

## 📅 로드맵 체크리스트 (Roadmap Checklist)

### 🟦 Phase 2: IDE Client 연동 및 탐색기 시각화 (v1.5)
- [ ] **VS Code Extension 개발 (`packages/vscode`)**
  - [ ] `vscode.FileDecorationProvider`를 활용한 탐색기 색상 및 배지 데코레이션 구현
    - [ ] 데드 파일: 회색 이름 + `[D]` 배지 부착
    - [ ] 미사용 수출 보유 파일: `[U]` 배지 부착
  - [ ] 파일 및 디렉토리 Watcher를 통한 증분 변경 감지 로직 연동
  - [ ] 에디터 및 탐색기 컨텍스트 메뉴(우클릭)에 `DeadFinder: Explain Why Dead` 명령어 바인딩
  - [ ] 설명 패널/아웃풋 채널(Output Channel) 연계 결과 출력부 개발
- [ ] **WebStorm / IntelliJ Plugin 개발 (`packages/webstorm`)**
  - [ ] `ProjectViewNodeDecorator`를 상속한 탐색기 파일 노드 폰트 취소선 및 색상 변경
  - [ ] 파일 아이콘 오버레이(☠️/❌) 및 미사용 수출 도트 배지 데코레이션 구현
  - [ ] `PsiTreeChangeListener`를 통한 PSI 트리 실시간 변경 스트림 연동
- [ ] **초고속 증분 분석 엔진 (Incremental Engine) 탑재**
  - [ ] Watcher 변경 시 Incoming Edges 역추적을 통한 영향 범위(하위/상위 노드) 국소화 알고리즘 최적화
  - [ ] 변경된 파일 단일 파싱 및 로컬 그래프 엣지 부분 갱신(Re-indexing) 구현
  - [ ] 서브트리 국소 BFS/DFS Traversal 최적화 (저장 시 반영 시간 < 50ms 목표)

### 🟥 Phase 3: Vue 심층 의미 분석 확장 (v2.0)
- [ ] **Unused Props / Emits / Slots Query 구현**
  - [ ] 자식 컴포넌트 `defineProps` 스키마와 부모 템플릿 바인딩 속성 정적 매핑
  - [ ] 자식 컴포넌트 `defineEmits` 스키마와 부모 템플릿 `@event` 핸들러 매핑
  - [ ] 자식 컴포넌트 `<slot>` 정의와 부모 컴포넌트 `#slot` 주입 여부 정적 교차 검증
- [ ] **Unused Pinia Store Query 구현**
  - [ ] `defineStore` 선언 추출 및 스토어 모듈의 State, Getter, Action 관계 정적 색인
  - [ ] 스토어 인스턴스를 불러와 사용하는 컴포넌트 및 파일의 접근 패턴(추적) 분석
  - [ ] 사용되지 않는 State/Action 속성 데드 코드화 및 리포트
- [ ] **Unused Router & Assets Query 구현**
  - [ ] `vue-router` 설정의 라우트 매핑 파일과 실제 도달 경로(Navigation Route) 분석
  - [ ] 정적 자산(assets/ 이미지, 폰트 등)의 파일 내 src 바인딩 및 import 매핑 분석을 통해 미사용 파일 선별

### 🚀 궁극적인 진화 방향
- [ ] **Auto-Prune (자동 가지치기)**
  - [ ] `deadfinder prune` 실행 시 안전하게 삭제가 보장되는 DEAD 파일(Orphan 파일 등)의 영구 삭제/보관 기능 구현
- [ ] **CI/CD 및 GitHub Actions Integration**
  - [ ] PR 생성 시 신규 유입/누적된 데드코드 비율 체크 및 봇 코멘트 기능 구현
