/* faceted-datatable-cf
 * datatables, facets, filters controlled by crossfilter
 *
 * Author: Sigfried Gold
 *				 based on faceted-datatable, written by Frank DeFalco and/or Chris Knoll
 *
 * in the old faceted-datatable, filter state was maintained in each facet
 * object in the 'Selected' property.
 *
 * faceted-datatable-cf has some new features that complicate things a little:
 *	- crossfilter is used for filtering records, which is much faster than the old code
 *	- filter state can now be saved to the url (should be optional, but isn't yet)
 *	- filter changes can be broadcast to external listeners
 *	- external filter changes can be caught and reflected here
 *	- facets and columns can now be defined as ohdsi.util.Field objects
 *
 * facet members have to be recalculated when:
 *	- facet selection changes locally
 *	- a filter is set externally (the filter will be reflected in crossfilter,
 *																even though it's not based on a facet)
 *	- the records observable changes (externally)
 *	- facets are initialized
 *	- ?

 		replacing crossfilter with ohdsi.util.SharedCrossfilter
		(not sure if this invalidates comments above...rushing to meet deadline)
 */
"use strict";
define(['knockout', 'text!./faceted-datatable-cf.html', 'lodash', 'ohdsi.util', 'knockout.dataTables.binding', 'colvis'], 
			 function (ko, view, _, util) {

	var reduceToRecs = [(p, v, nf) => p.concat(v), (p, v, nf) => _.without(p, v), () => []];
	function facetedDatatable(params) {
		window.ko = ko;
        window.util = util;
		var self = this;

		self.options = params.options; // passed directly to datatable binding
		self.saveState = ko.utils.unwrapObservable(params.saveStateToUrl);
		if (typeof self.saveState !== "undefined" && !self.saveState) {
			console.warn("not currently possible to turn off saving state to url");
		}
		self.filterNameSpace = params.filterNameSpace || '';

		// must be observable or undefined
		self.sharedCrossfilter = params.sharedCrossfilter || 
						ko.observable(new util.SharedCrossfilter([]));


		self.jqEventSpace = params.jqEventSpace || {};

		self.data = ko.observableArray([]);
		self.facets = ko.observableArray([]);

		self.rowCallback = params.rowCallback;
		self.rowClick = params.rowClick || (()=>{});

		// Maybe you want to use facets for filtering, but
		// not the data table?
		self.facetsOnly = params.facetsOnly;

		// Set some defaults for the data table
		self.autoWidth = params.autoWidth || true;
		self.buttons = params.buttons || [
				'colvis','copyHtml5','excelHtml5','csvHtml5','pdfHtml5'
		];
		self.colVis = params.colVis || {
						buttonText: 'Change Columns',
						align: 'right',
						overlayFade: 0,
						showAll: 'Show All Columns',
						restore: 'Reset Columns'
					};
		self.dom = params.dom || 'Blfiprt';
		self.language = params.language || {
						search: 'Filter: '
					};
		self.lengthMenu = params.lengthMenu || [[15, 30, 45, -1], [15, 30, 45,'All']];
		self.order = params.order || [[1,'desc']];
		self.orderClasses = params.orderClasses || false;
		self.ordering = params.ordering || true;

		self.searchDim = {
			name: 'datatable-search',
			accessor: d=>d,
		};
		self.initCompleteCallback = function(dtStuff) {
			//var dt=$('table.dataTable.cf').DataTable();
			var dt = self.dt = $(dtStuff.nTableWrapper).find('table').DataTable();
			var firstTimeThrough = true;
			var noSearchState = true;
			var searchStr;
			dt.on('search.dt', function(e, settings) { 
				if (firstTimeThrough) {
					firstTimeThrough = false;
					searchStr = util.getState([filterStateKey(), 'search']);
					if (_.isEmpty(searchStr))
						return;
					firstTimeThrough = false;
					noSearchState = false;
					dt.search(searchStr);
				} else {
					searchStr = dt.search();
				}
				var ret;
				if(noSearchState && searchStr === (util.getState([filterStateKey(), 'search'])||'')) {
					ret = ()=>false; //
				} else if (searchStr.length === 0) {
					util.deleteState([filterStateKey(), 'search']);
					ret = ()=>false; //
					updateSearchFilter(searchStr);
				} else {
					util.setState([filterStateKey(), 'search'], searchStr);
					updateSearchFilter(searchStr);
					ret = true;
				}
				return ret;
			});
		};
		function searchSetup() {
			self.sharedCrossfilter().dimField('datatable-search', self.searchDim);
		}
		function updateSearchFilter(searchStr, tellListenersToWait = false) {
			if (searchStr) {
				var func = rec => {
					return _.chain(rec).values().compact().some(val => val.toString().match(new RegExp(searchStr,'i'))).value();
				};
			} else {
				var func = null;
			}
			self.sharedCrossfilter().filter('datatable-search', func, 
							{source:'datatable-search', waitForMore: tellListenersToWait});
			return !!func;
		};

		newRecs(ko.utils.unwrapObservable(params.recs));
		if (ko.isSubscribable(params.recs)) {
			params.recs.subscribe(function(recs) {
				console.warn("changing recs externally. if you're trying to filter you should probably be using ohdsi.util.SharedCrossfilter");
				newRecs(recs);
			});
		}

		function newRecs(recs) {
			var scf = self.sharedCrossfilter();
			if (recs !== ko.utils.unwrapObservable(params.recs)) {
				scf.replaceData(recs);
			}
			processFieldFacetColumnParams();
				// really facets and datatables should be separate components
			columnSetup();
			facetSetup();
			searchSetup();
			self.data(recs); // for passing to datatable binding
		}
		function processFieldFacetColumnParams() {
			// if fields parameter is supplied, columns and facets will be ignored
			if (params.fields) {
				var fields = ko.utils.unwrapObservable(params.fields);
				self.columns = _.filter(fields, d=>d.isColumn);
				self._facets = _.filter(fields, d=>d.isFacet);
				if (ko.isSubscribable(params.fields)) {
					params.fields.subscribe(function(fields) {
						self.columns = _.filter(fields, d=>d.isColumn);
						self._facets = _.filter(fields, d=>d.isFacet);
					});
				}
			} else {
				console.warn(`still supporting old style facet/column config, but 
										  probably best to use ohdsi.util.Field and fields param`);
				if (ko.isObservable(params.columns)) {
					throw new Error("can't deal with observable columns");
				}
				self.columns = params.columns;
				self._facets = ko.utils.unwrapObservable(params.facets || []);
				if (ko.isSubscribable(params.facets)) {
					params.facets.subscribe(function(facets) {
						// this should only trigger if new facets are set externally
						throw new Error("not allowing changing external facets for now");
						newRecs(ko.utils.unwrapObservable(params.recs));
					});
				}
			}
		}
		function columnSetup() {
			sharedSetup(self.columns);
			self.columns.forEach(function(column) {
				column.title = column.title || d3.functor(column.label)();
				column.render = function(data, type, row, meta) {
					// see https://datatables.net/reference/option/columns.render
					if (typeof data !== "undefined")
						return row[data];
					return column.accessor(row);
				};
			})
		}
		function facetSetup() {
			sharedSetup(self._facets);
			self._facets.forEach(function(facet) {
				facet.caption = facet.caption || d3.functor(facet.label)();
				facet.Members = [];
				self.sharedCrossfilter().dimField(facet.name, facet);
				/*
				facet.cfDim = self.crossfilter.dimension(facet.accessor);
				facet.cfDimGroup = facet.cfDim.group();
				facet.cfDimGroup.reduce(...reduceToRecs);
				// can't recall why these were needed at one time
				//facet.cfDimGroupAll = facet.cfDim.groupAll();
				//facet.cfDimGroupAll.reduce(...reduceToRecs);
				*/
			})
			//self.facets(self._facets);
			var filtersExist = false;
			self._facets.forEach(facet=>{
				filtersExist = filtersExist || updateOneFacetsFilters(facet, true);
			});
			updateFacetUI();
			if (filtersExist) {
				$(self.sharedCrossfilter()).trigger('filterEvt', 
						[{ source: 'datatable.facet', waitForMore: 'done' }]);
			}
		}
		function sharedSetup(fields = []) {
			fields.forEach(function(field) {
				// need to consistently define what labels and titles and stuff are called and how they're defined
				// but this is ok for now
				if (field instanceof util.Field) {
					//field.accessor = field.accessors.value;
					//happening if Field class now
				} else {
					field.label = field.label || field.fname;
					field.value = field.value || field.fname;
                    field.name = field.name || field.fname || field.propName || field.label;
					field.accessor = field.value || (d=>d);
					if (typeof field.accessor === "string" || isFinite(field.accessor)) {
						field.accessor = d => d[field.value];
					}
					if (typeof field.accessor !== "function") {
						throw new Error("field.value must be function or string or index");
					}
				}
			});
		}

		function filterStateKey() {
			return `filters${self.filterNameSpace ?
								('.' + self.filterNameSpace) :
								''}`;
		}
		function filterName(facetName, memberName) {
			if (typeof memberName === 'undefined') {
				return `${filterStateKey()}.${facetName}`;
			} else {
				return `${filterStateKey()}.${facetName}.${memberName}`;
			}
		}
		function filterVal(facetName, memberName) {
			return !!util.getState(filterName(facetName, memberName));
		}
		self.toggleFilter = function(data, event) {
			var context = ko.contextFor(event.target);
			var memberName = context.$data.Name;
			var facet = context.$parent;
			var facetName = facet.name;
			var filterOn = !filterVal(facetName, memberName);
			var filterSwitched = filterName(facetName,memberName)
			if (filterOn) {
				util.setState(filterSwitched, true);
			} else {
				util.deleteState(filterSwitched);
				if (_.keys(util.getState(filterName(facetName))).length === 0) {
					util.deleteState(filterName(facetName));
				}
			}
			/*
			$(self.jqEventSpace)
				.trigger('filter', {
															source:'datatable',
															filter: {[filterSwitched]: filterOn},
														});
			*/
			var filterOn = updateOneFacetsFilters(facet);
			updateFacetUI();
		}
		function updateOneFacetsFilters(facet, initialSetup = false) {
			// should only get here if:
			//		1) loading page and initializing facet filters
			//		2) toggled a facet filter
			var filters = util.getState(filterStateKey()) || {};
			if (filters[facet.name]) {
				// there's at least one Member chosen for this facet
				// func will receive the member name (the result of applying
				//		the facet's accessor to a data record) and will return
				//		true if that member is included in the filter state for
				//		the facet
				var func = d => filterVal(facet.name, d);
			} else {
				// no members chosen for this facet. clear filter, which means all
				//		records pass
				var func = null;
				if (initialSetup) return;
			}
			self.sharedCrossfilter().filter(facet.name, func, 
							{source:'datatable.facet', waitForMore: initialSetup});
			// should maybe say *which* datatable, in case there's more than one
			// on a page, but not dealing with that yet.
			return !!func;
		};
		function updateFacetUI(updateData=true) {
			self._facets.forEach(facet=>{
				facet.Members = self.sharedCrossfilter().group(facet.name).all().map(
					group => {
						var selected = filterVal(facet.name, group.key);
						return {
							Name: group.key,
							ActiveCount: facet.countFunc ? facet.countFunc(group) : group.value.length,
							Selected: selected,
						};
					});
				facet.Members = _.sortBy(facet.Members, d => -d.ActiveCount);
			});
			self.facets.removeAll()
			self.facets.push(...self._facets);

			//updateData && 
			self.data(self.sharedCrossfilter().filteredRecs());
		}
		$(self.sharedCrossfilter()).on('filterEvt', 
			function(evt, {dimField, source} = {}) {
				if (source === 'datatable.facet') {
					return; // already handled
				}
				updateFacetUI(source!=='datatable-search');
			});
	};

	var component = {
		viewModel: facetedDatatable,
		template: view
	};

	ko.components.register('faceted-datatable-cf', component);
	return component;
});
