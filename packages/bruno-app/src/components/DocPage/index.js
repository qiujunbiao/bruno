import 'github-markdown-css/github-markdown.css';
import find from 'lodash/find';
import get from 'lodash/get';
import { useDispatch, useSelector } from 'react-redux';
import { useTheme } from 'providers/Theme';
import { updateDocPageDocs } from 'providers/ReduxStore/slices/collections';
import { saveRequest } from 'providers/ReduxStore/slices/collections/actions';
import { updateDocsEditing } from 'providers/ReduxStore/slices/tabs';
import Markdown from 'components/MarkDown';
import CodeEditor from 'components/CodeEditor';
import StyledWrapper from 'components/Documentation/StyledWrapper';

const DocPage = ({ item, collection }) => {
  const dispatch = useDispatch();
  const { displayedTheme } = useTheme();
  const tabs = useSelector((state) => state.tabs.tabs);
  const activeTabUid = useSelector((state) => state.tabs.activeTabUid);
  const focusedTab = find(tabs, (t) => t.uid === activeTabUid);
  const isEditing = focusedTab?.docsEditing || false;
  const preferences = useSelector((state) => state.app.preferences);
  const docs = item.draft ? get(item, 'draft.docs', '') : get(item, 'docs', '');

  const toggleViewMode = () => {
    dispatch(updateDocsEditing({ uid: activeTabUid, docsEditing: !isEditing }));
  };

  const onEdit = (value) => {
    dispatch(updateDocPageDocs({
      itemUid: item.uid,
      collectionUid: collection.uid,
      docs: value
    }));
  };

  const onSave = () => dispatch(saveRequest(item.uid, collection.uid));

  return (
    <StyledWrapper className="flex flex-col gap-y-1 h-full w-full relative px-4 pb-4">
      <div className="editing-mode" role="tab" onClick={toggleViewMode}>
        {isEditing ? 'Preview' : 'Edit'}
      </div>

      {isEditing ? (
        <CodeEditor
          collection={collection}
          theme={displayedTheme}
          font={get(preferences, 'font.codeFont', 'default')}
          fontSize={get(preferences, 'font.codeFontSize')}
          value={docs || ''}
          onEdit={onEdit}
          onSave={onSave}
          mode="application/text"
        />
      ) : (
        <Markdown collectionPath={collection.pathname} onDoubleClick={toggleViewMode} content={docs} />
      )}
    </StyledWrapper>
  );
};

export default DocPage;
