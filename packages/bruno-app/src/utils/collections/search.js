import { flattenItems, isItemARequest, isItemADoc } from './index';
import filter from 'lodash/filter';
import find from 'lodash/find';

export const doesRequestMatchSearchText = (request, searchText = '') => {
  return request?.name?.toLowerCase().includes(searchText.toLowerCase());
};

export const doesDocMatchSearchText = (doc, searchText = '') => {
  const query = searchText.toLowerCase();
  return doc?.name?.toLowerCase().includes(query) || doc?.docs?.toLowerCase().includes(query);
};

export const doesFolderHaveItemsMatchSearchText = (item, searchText = '') => {
  let flattenedItems = flattenItems(item.items);
  let requestItems = filter(flattenedItems, (item) => (isItemARequest(item) || isItemADoc(item)) && !item.isTransient);

  return find(requestItems, (item) => isItemADoc(item) ? doesDocMatchSearchText(item, searchText) : doesRequestMatchSearchText(item, searchText));
};

export const doesCollectionHaveItemsMatchingSearchText = (collection, searchText = '') => {
  let flattenedItems = flattenItems(collection.items);
  let requestItems = filter(flattenedItems, (item) => (isItemARequest(item) || isItemADoc(item)) && !item.isTransient);

  return find(requestItems, (item) => isItemADoc(item) ? doesDocMatchSearchText(item, searchText) : doesRequestMatchSearchText(item, searchText));
};
